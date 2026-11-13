import "server-only";
/**
 * Loader for the laundry run full page (`/v2/admin/laundry/runs/[id]`). Reads
 * the run with the Pipeline card's facts (`loadRunCard`), its history, the
 * emailed-report lock, the next clean and who can be named as "done by". No
 * writes. Times are formatted in the organisation's time zone; calendar days
 * are not shifted.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadRunCard, type RunCard } from "./pipeline-server";
import { loadSupplierTeams, teamForRun } from "./partners";
import { laundryTeamRequestKinds } from "./nudge-rules";
import { TEAM_REQUEST_LABELS, type LaundryTeamRequestKind } from "./nudge-rules";
import { describeLaundryConfirmation } from "./media";
import { emailedReportContaining, emailedReportLabel, isVoidableStatus, stateName } from "./run-correction-rules";
import { cleanerHandoffAt, hasFailedPickup, loadEmailedReportScopes, pendingFailedPickupRequest, OFFICE_CORRECTION_EVENT, RUN_VOIDED_EVENT, RUN_VOID_UNDONE_EVENT, TEAM_RECORD_AFTER_CORRECTION_EVENT, FAILED_PICKUP_VOIDED_EVENT } from "./run-corrections";
import { laundryTaskAmount } from "./invoice";
import type { RunCorrectionRow, RunFailedPickup, RunHistoryEntry, RunHistoryKind, RunInvoiceLine, RunPageExtras } from "./run-page-types";

type Meta = Record<string, unknown>;

function meta(notes: string | null | undefined): Meta {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? (parsed as Meta) : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type Confirmation = { id: string; notes: string | null; laundryReady: boolean; createdAt: Date; photoUrl: string | null; confirmedById: string; confirmedByName?: string | null; bagLocation: string | null };

const AUDIT_SHOWN_ELSEWHERE = new Set(["LAUNDRY_OFFICE_CORRECTION", "LAUNDRY_RUN_VOIDED", "LAUNDRY_RUN_VOID_UNDONE", "LAUNDRY_TEAM_RECORD_KEPT_BESIDE_CORRECTION", "LAUNDRY_FAILED_PICKUP_RESCHEDULED", "LAUNDRY_FAILED_PICKUP_APPROVAL_REQUESTED"]);

function auditLabel(action: string, after: Meta): string {
  switch (action) {
    case "LAUNDRY_TEAM_REQUEST_SENT": {
      const kind = String(after.kind ?? "") as LaundryTeamRequestKind;
      return TEAM_REQUEST_LABELS[kind]?.title ?? "Asked the laundry team";
    }
    case "LAUNDRY_PLANNED_TIMES_UPDATED":
      return after.source === "LAUNDRY_TEAM_ANSWER" ? "Planned time set from the laundry team's answer" : "Planned times changed";
    case "APPROVE_FAILED_PICKUP_SKIP":
      return "Skip request approved";
    case "REJECT_FAILED_PICKUP_REQUEST":
      return "Skip request rejected";
    default: {
      const words = action.replace(/^LAUNDRY_/, "").toLowerCase().replace(/_/g, " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  }
}

function confirmationKind(event: string): RunHistoryKind {
  if (event === OFFICE_CORRECTION_EVENT) return "correction";
  if (event === RUN_VOIDED_EVENT || event === RUN_VOID_UNDONE_EVENT || event === FAILED_PICKUP_VOIDED_EVENT) return "void";
  if (!event) return "handoff";
  return "team";
}

function confirmationLabel(row: Confirmation, data: Meta): { label: string; detail: string | null } {
  const event = String(data.event ?? "");
  switch (event) {
    case OFFICE_CORRECTION_EVENT:
      return {
        label: `Office correction: ${stateName(String(data.fromStatus ?? ""))} → ${stateName(String(data.toStatus ?? ""))}`,
        detail: [text(data.doneByName) ? `Done by ${text(data.doneByName)}` : null, text(data.reason)].filter(Boolean).join(" · ") || null,
      };
    case RUN_VOIDED_EVENT:
      return { label: "Voided", detail: text(data.reason) };
    case RUN_VOID_UNDONE_EVENT:
      return { label: `Void undone, back to ${stateName(String(data.restoredStatus ?? ""))}`, detail: text(data.reason) };
    case FAILED_PICKUP_VOIDED_EVENT:
      return { label: "Skip request closed: Voided by office", detail: null };
    case TEAM_RECORD_AFTER_CORRECTION_EVENT:
      return { label: `Laundry team's own ${data.leg === "DROP" ? "drop-off" : "pickup"} record, kept beside the office correction`, detail: row.photoUrl ? "With photo" : null };
    default: {
      const described = describeLaundryConfirmation(row);
      if (!event) {
        return { label: row.laundryReady ? "Cleaner handoff: ready" : "Cleaner handoff: not ready", detail: [row.bagLocation, described].filter(Boolean).join(" · ") || null };
      }
      return { label: described ?? auditLabel(event, data), detail: row.photoUrl ? "With photo" : null };
    }
  }
}

export type RunPageLoad = { card: RunCard; extras: RunPageExtras };

export async function loadLaundryRunPage(
  taskId: string,
  viewer: { id: string; role: Role; isAdmin: boolean; canChangeState: boolean; canVoid: boolean; voidBlockedReason: string | null; name: string | null },
  timeZone: string,
  todayKey: string,
): Promise<RunPageLoad | null> {
  const card = await loadRunCard(taskId, { role: viewer.role, userId: viewer.id });
  if (!card) return null;
  const confirmations = (card.confirmations as unknown as Confirmation[]) ?? [];
  const fmt = (value: Date | string | null | undefined) => (value ? formatInTimeZone(new Date(value), timeZone, "EEE d MMM yyyy HH:mm") : null);

  const raw = await db.laundryTask.findUnique({
    where: { id: taskId },
    select: { id: true, voidedAt: true, voidedById: true, voidReason: true, voidPreviousStatus: true, jobId: true, propertyId: true, pickupDate: true, dropoffDate: true, droppedAt: true, dropoffCostAud: true, supplierId: true, createdAt: true, job: { select: { scheduledDate: true } }, property: { select: { accessInfo: true, laundryEnabled: true } } },
  });
  if (!raw) return null;

  const [audits, reports, nextJob, voider, teams] = await Promise.all([
    db.auditLog.findMany({ where: { entity: "LaundryTask", entityId: taskId }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, action: true, createdAt: true, after: true, user: { select: { name: true } } } }),
    loadEmailedReportScopes(),
    db.job.findFirst({
      where: { propertyId: raw.propertyId, jobType: "AIRBNB_TURNOVER", id: { not: raw.jobId }, scheduledDate: { gt: raw.job.scheduledDate }, status: { notIn: ["CANCELLED"] } },
      orderBy: { scheduledDate: "asc" },
      select: { id: true, jobNumber: true, scheduledDate: true, startTime: true },
    }).catch(() => null),
    raw.voidedById ? db.user.findUnique({ where: { id: raw.voidedById }, select: { name: true } }) : Promise.resolve(null),
    raw.supplierId ? loadSupplierTeams([raw.supplierId]) : Promise.resolve(new Map()),
  ]);

  // History: every confirmation row (handoffs, team records, corrections,
  // voids) and the audit rows not already represented by one.
  const history: RunHistoryEntry[] = [];
  history.push({ id: "created", at: raw.createdAt.toISOString(), when: fmt(raw.createdAt)!, who: null, label: "Run created", detail: null, kind: "system" });
  for (const row of confirmations) {
    const data = meta(row.notes);
    const { label, detail } = confirmationLabel(row, data);
    history.push({ id: row.id, at: new Date(row.createdAt).toISOString(), when: fmt(row.createdAt)!, who: row.confirmedByName ?? null, label, detail, kind: confirmationKind(String(data.event ?? "")) });
  }
  for (const audit of audits) {
    if (AUDIT_SHOWN_ELSEWHERE.has(audit.action)) continue;
    const after = (audit.after ?? {}) as Meta;
    history.push({ id: audit.id, at: audit.createdAt.toISOString(), when: fmt(audit.createdAt)!, who: audit.user?.name ?? null, label: auditLabel(audit.action, after), detail: null, kind: "office" });
  }
  history.sort((a, b) => b.at.localeCompare(a.at));

  const failedPickups: RunFailedPickup[] = confirmations
    .filter((row) => ["FAILED_PICKUP_RESCHEDULE", "FAILED_PICKUP_REQUEST"].includes(String(meta(row.notes).event ?? "")))
    .map((row) => {
      const data = meta(row.notes);
      const rescheduled = text(data.rescheduledPickupDate);
      return {
        id: row.id, when: fmt(row.createdAt)!, who: row.confirmedByName ?? null, reason: text(data.reason), photoUrl: row.photoUrl,
        outcome: data.event === "FAILED_PICKUP_RESCHEDULE"
          ? `Moved to ${rescheduled ? formatInTimeZone(new Date(rescheduled), "UTC", "EEE d MMM") : "a later day"}`
          : `Asked the office to approve a ${String(data.requestedAction ?? "skip").toLowerCase()}`,
      };
    });

  const corrections: RunCorrectionRow[] = confirmations
    .filter((row) => meta(row.notes).event === OFFICE_CORRECTION_EVENT)
    .map((row) => {
      const data = meta(row.notes);
      const later = confirmations.find((other) => meta(other.notes).event === TEAM_RECORD_AFTER_CORRECTION_EVENT && meta(other.notes).correctionId === row.id);
      return {
        id: row.id, when: fmt(row.createdAt)!, who: row.confirmedByName ?? null,
        fromLabel: stateName(String(data.fromStatus ?? "")), toLabel: stateName(String(data.toStatus ?? "")),
        doneBy: text(data.doneByName), reason: text(data.reason), backwards: data.backwards === true,
        teamRecordWhen: later ? fmt(later.createdAt) : null,
      };
    });

  const pending = pendingFailedPickupRequest(confirmations);
  const pendingMeta = pending ? meta(pending.notes) : null;
  const report = emailedReportContaining(raw, reports);
  const amount = raw.dropoffCostAud;
  const invoiceLine: RunInvoiceLine = raw.voidedAt
    ? { state: "none", label: "On no laundry report", detail: "A voided run is left out of every laundry report, admin and partner." }
    : report
      ? { state: "emailed", label: "On an emailed laundry report", detail: `The report was ${emailedReportLabel(report)}. An issued record is never rewritten: corrections go on a later report.` }
      : raw.droppedAt
        ? { state: "draft", label: "Not on an emailed report yet", detail: amount != null ? `Reports by drop-off date list it at $${laundryTaskAmount(null, amount).toFixed(2)} (stored cost).` : "No price recorded. Reports list it, but today's report prints $0.00 for a missing price until one is entered." }
        : { state: "none", label: "Not on an invoice yet", detail: "Reports by drop-off date list a run once it is delivered." };

  const viewerOption = { id: viewer.id, label: `Office: ${viewer.name?.trim() || "me"}` };
  const team = raw.supplierId ? teamForRun(teams, raw.supplierId, raw.property) : [];
  const doneByOptions = [
    ...team.map((member) => ({ id: member.id, label: `${member.name?.trim() || "Laundry team member"}${card.supplier && typeof (card.supplier as { name?: unknown }).name === "string" ? `, ${(card.supplier as { name: string }).name}` : ""}` })),
    viewerOption,
  ];

  const teamRequestKinds = card.supplierTeam && card.supplierTeam.count > 0
    ? laundryTeamRequestKinds({
        status: card.status, pickupDate: raw.pickupDate, dropoffDate: raw.dropoffDate, exceptions: card.exceptions, readiness: card.readiness,
        jobStatus: (card.job as { status?: string } | null)?.status ?? null, hasJob: true, hasSupplier: Boolean(raw.supplierId),
      }, todayKey)
    : [];

  const handoff = cleanerHandoffAt(confirmations);
  const extras: RunPageExtras = {
    voided: raw.voidedAt ? { when: fmt(raw.voidedAt)!, who: voider?.name ?? null, reason: raw.voidReason ?? "", previousStatus: stateName(raw.voidPreviousStatus ?? "") } : null,
    pendingSkipRequest: pending && !raw.voidedAt ? { requestedAction: pendingMeta?.requestedAction === "DELETE" ? "DELETE" : "SKIP", reason: text(pendingMeta?.reason), when: fmt(pending.createdAt)!, who: (pending as Confirmation).confirmedByName ?? null } : null,
    failedPickups,
    corrections,
    handoffWhen: fmt(handoff),
    handoffAtIso: handoff ? handoff.toISOString() : null,
    emailedReport: report ? emailedReportLabel(report) : null,
    invoiceLine,
    nextClean: nextJob ? { jobId: nextJob.id, jobNumber: nextJob.jobNumber, when: `${formatInTimeZone(nextJob.scheduledDate, "UTC", "EEE d MMM yyyy")}${nextJob.startTime ? ` ${nextJob.startTime}` : ""}` } : null,
    history,
    doneByOptions,
    voidable: !raw.voidedAt && isVoidableStatus({ status: card.status, hasFailedPickup: hasFailedPickup(confirmations) }),
    teamRequestKinds,
    pickupWhen: fmt((card as { pickedUpAt?: Date | null }).pickedUpAt ?? null),
    droppedWhen: fmt(raw.droppedAt),
    createdWhen: fmt(raw.createdAt),
  };
  return { card, extras };
}

/**
 * "Done by" choices for Change state on several runs: the laundry team members
 * who work on every one of them (by partner and property), then the office
 * person saving. Names only for the menu; the server checks the choice again.
 */
export async function loadDoneByOptions(taskIds: string[], viewer: { id: string; name: string | null }): Promise<Array<{ id: string; label: string }>> {
  const tasks = await db.laundryTask.findMany({ where: { id: { in: taskIds } }, select: { supplierId: true, supplier: { select: { name: true } }, property: { select: { accessInfo: true, laundryEnabled: true } } } });
  const teams = await loadSupplierTeams(tasks.map((task) => task.supplierId ?? "").filter(Boolean));
  const perRun: Array<Map<string, string>> = tasks.map((task) => {
    const members = task.supplierId ? teamForRun(teams, task.supplierId, task.property) : [];
    return new Map(members.map((member) => [member.id, `${member.name?.trim() || "Laundry team member"}${task.supplier?.name ? `, ${task.supplier.name}` : ""}`] as [string, string]));
  });
  const first = perRun[0] ?? new Map<string, string>();
  const common: Array<[string, string]> = Array.from(first.entries()).filter(([id]) => perRun.every((run) => run.has(id)));
  return [
    ...common.map(([id, label]) => ({ id, label })),
    { id: viewer.id, label: `Office: ${viewer.name?.trim() || "me"}` },
  ];
}
