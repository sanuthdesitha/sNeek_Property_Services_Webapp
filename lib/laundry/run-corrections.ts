/**
 * Server side of "Change state" and "Void / Undo void" for laundry runs
 * (owner request 2026-11-14). The rules are in `./run-correction-rules.ts`.
 *
 * - Every change locks the run, checks the version the person saw, and writes
 *   the run, a new LaundryConfirmation row (event OFFICE_CORRECTION,
 *   RUN_VOIDED or RUN_VOID_UNDONE carrying the before values) and an audit row
 *   (actor, effective role, the real person behind a "Test as" session) in one
 *   transaction. No earlier confirmation, photo or receipt is edited.
 * - A void stores the run as SKIPPED_PICKUP with `voidedAt`, `voidedById`,
 *   `voidReason` and `voidPreviousStatus`; Undo void restores the previous
 *   state. A pending failed-pickup request closes as "Voided by office".
 * - Nothing is sent to the laundry team unless the person ticked it; then an
 *   inbox notice goes through the notification pipeline (never another transport).
 */
import { Prisma, Role, type LaundryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { propertyIsVisibleToLaundry } from "./teams";
import { partnerMayWriteRun } from "./partner-entry-rules";
import { LAUNDRY_SKIP_REASON_CODES } from "./constants";
import { stripTaskFromStops } from "./deletion";
import { parseRouteStops } from "./route-plan";
import {
  emailedReportContaining,
  emailedReportLabel,
  figureProblem,
  planChangeState,
  stateName,
  undoVoidRefusal,
  voidRefusal,
  type ChangeStateRequest,
  type EmailedReportScope,
  type OptionalFigures,
} from "./run-correction-rules";

export class RunCorrectionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type CorrectionActor = {
  id: string;
  role: Role | string;
  /** The administrator behind a "Test as" session, when there is one. */
  actualActorId?: string | null;
};

export const OFFICE_CORRECTION_EVENT = "OFFICE_CORRECTION";
export const RUN_VOIDED_EVENT = "RUN_VOIDED";
export const RUN_VOID_UNDONE_EVENT = "RUN_VOID_UNDONE";
export const TEAM_RECORD_AFTER_CORRECTION_EVENT = "TEAM_RECORD_AFTER_OFFICE_CORRECTION";
export const FAILED_PICKUP_VOIDED_EVENT = "FAILED_PICKUP_REQUEST_VOIDED";

type Tx = Prisma.TransactionClient;

function parseNotes(notes: string | null | undefined): Record<string, unknown> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type ConfirmationRow = { notes: string | null; laundryReady: boolean; createdAt: Date };

/** The cleaner's latest "ready" handoff (a row with no event). */
export function cleanerHandoffAt(confirmations: readonly ConfirmationRow[]): Date | null {
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const row = confirmations[index];
    const event = parseNotes(row.notes).event;
    if ((event === undefined || event === null || event === "") && row.laundryReady === true) return row.createdAt;
  }
  return null;
}

export function hasFailedPickup(confirmations: readonly ConfirmationRow[]): boolean {
  return confirmations.some((row) => {
    const event = String(parseNotes(row.notes).event ?? "");
    return event === "FAILED_PICKUP_RESCHEDULE" || event === "FAILED_PICKUP_REQUEST";
  });
}

/** A failed-pickup request still waiting for a decision (the approve route's own test). */
export function pendingFailedPickupRequest<T extends { notes: string | null }>(confirmations: readonly T[]): T | null {
  const decided = new Set(["FAILED_PICKUP_SKIP_APPROVED", "FAILED_PICKUP_REQUEST_REJECTED"]);
  // Undo void reopens the request the void closed.
  let reopened = false;
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const meta = parseNotes(confirmations[index].notes);
    const event = String(meta.event ?? "");
    if (event === RUN_VOID_UNDONE_EVENT) { reopened = true; continue; }
    if (event === FAILED_PICKUP_VOIDED_EVENT) {
      if (reopened) { reopened = false; continue; }
      return null;
    }
    if (decided.has(event)) return null;
    if (meta.event === "FAILED_PICKUP_REQUEST" && meta.approvalStatus === "PENDING") return confirmations[index];
  }
  return null;
}

/** Every emailed laundry report's recorded scope (the only "issued" trace). */
export async function loadEmailedReportScopes(client: Tx | typeof db = db): Promise<EmailedReportScope[]> {
  const rows = await client.auditLog.findMany({
    where: { entity: "LaundryReport", action: "LAUNDRY_REPORT_EMAIL" },
    select: { createdAt: true, entityId: true, after: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => {
    const after = (row.after ?? {}) as Record<string, unknown>;
    const taskIds = Array.isArray(after.taskIds) ? after.taskIds.filter((id): id is string => typeof id === "string") : null;
    return {
      createdAt: row.createdAt,
      taskIds,
      taskId: typeof after.taskId === "string" && after.mode === "single_task" ? after.taskId : null,
      startDate: typeof after.startDate === "string" ? after.startDate : null,
      endDate: typeof after.endDate === "string" ? after.endDate : null,
      propertyId: typeof after.propertyId === "string" ? after.propertyId : null,
    };
  });
}

const TASK_INCLUDE = {
  property: { select: { id: true, name: true, accessInfo: true, laundryEnabled: true } },
  confirmations: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { id: true, notes: true, laundryReady: true, createdAt: true } },
} satisfies Prisma.LaundryTaskInclude;

async function lockRun(tx: Tx, taskId: string) {
  await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${taskId} FOR UPDATE`;
  const task = await tx.laundryTask.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!task) throw new RunCorrectionError(404, "NOT_FOUND", "Laundry run not found.");
  return task;
}

function checkVersion(task: { updatedAt: Date }, expectedUpdatedAt: string | null | undefined) {
  if (!expectedUpdatedAt) throw new RunCorrectionError(400, "VERSION_REQUIRED", "Reload the run before saving.");
  if (task.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new RunCorrectionError(409, "STALE", "This run changed since you loaded it. Reload and review it before saving again.");
  }
}

type DoneBy = { id: string; name: string | null; role: Role };

async function resolveDoneBy(tx: Tx, doneById: string, task: { supplierId: string | null; property: { accessInfo: unknown; laundryEnabled: boolean } }): Promise<DoneBy> {
  const user = await tx.user.findUnique({ where: { id: doneById }, select: { id: true, name: true, role: true, isActive: true, laundrySupplierId: true } });
  if (!user?.isActive) throw new RunCorrectionError(400, "DONE_BY_INVALID", "Choose an active person who did it.");
  if (user.role === Role.LAUNDRY) {
    if (!propertyIsVisibleToLaundry(task.property, user.id) || !partnerMayWriteRun(task.supplierId, user.laundrySupplierId)) {
      throw new RunCorrectionError(400, "DONE_BY_INVALID", "That laundry team member does not work on this run.");
    }
  } else if (user.role !== Role.ADMIN && user.role !== Role.OPS_MANAGER) {
    throw new RunCorrectionError(400, "DONE_BY_INVALID", "Choose a laundry team member or an office person.");
  }
  return { id: user.id, name: user.name, role: user.role };
}

export type ChangeStateInput = ChangeStateRequest & OptionalFigures & {
  taskId: string;
  expectedUpdatedAt: string;
  doneById?: string | null;
  notifyTeam?: boolean;
};

export type ChangeStateResult = {
  taskId: string;
  status: LaundryStatus;
  updatedAt: string;
  backwards: boolean;
  changes: string[];
  notice: NoticeOutcome;
};

export type NoticeOutcome = { requested: boolean; state: "not_requested" | "queued" | "no_team" | "failed"; recipients: number };

export async function changeLaundryRunState(actor: CorrectionActor, input: ChangeStateInput, now: Date = new Date()): Promise<ChangeStateResult> {
  const figureError = figureProblem(input);
  if (figureError) throw new RunCorrectionError(400, "FIGURE_INVALID", figureError);
  if (input.target === "SKIPPED" && input.skipReasonCode && !(LAUNDRY_SKIP_REASON_CODES as readonly string[]).includes(input.skipReasonCode)) {
    throw new RunCorrectionError(400, "SKIP_REASON_INVALID", "Choose one of the listed skip reasons.");
  }
  const reports = await loadEmailedReportScopes();
  const saved = await db.$transaction(async (tx) => {
    const task = await lockRun(tx, input.taskId);
    checkVersion(task, input.expectedUpdatedAt);
    const later = input.target === "PICKED_UP" || input.target === "READY_TO_RETURN" || input.target === "DROPPED";
    if (later && !input.doneById) throw new RunCorrectionError(400, "DONE_BY_REQUIRED", "Choose who did it.");
    const doneBy = later && input.doneById ? await resolveDoneBy(tx, input.doneById, task) : null;
    const onEmailedReport = Boolean(emailedReportContaining(task, reports));
    const plan = planChangeState({
      status: task.status, pickedUpAt: task.pickedUpAt, droppedAt: task.droppedAt, voidedAt: task.voidedAt,
      handoffAt: cleanerHandoffAt(task.confirmations), onEmailedReport,
    }, input, now);
    if (!plan.ok) throw new RunCorrectionError(plan.status, plan.code, plan.message);

    const before = {
      status: task.status, pickedUpAt: task.pickedUpAt?.toISOString() ?? null, droppedAt: task.droppedAt?.toISOString() ?? null,
      confirmedAt: task.confirmedAt?.toISOString() ?? null, bagWeightKg: task.bagWeightKg, dropoffCostAud: task.dropoffCostAud,
      skipReasonCode: task.skipReasonCode, skipReasonNote: task.skipReasonNote, flagNotes: task.flagNotes, noPickupRequired: task.noPickupRequired,
    };
    const data: Prisma.LaundryTaskUpdateInput = {
      status: plan.nextStatus as LaundryStatus,
      pickedUpAt: plan.pickedUpAt,
      droppedAt: plan.droppedAt,
    };
    if (plan.nextStatus === "CONFIRMED" && !task.confirmedAt) data.confirmedAt = cleanerHandoffAt(task.confirmations);
    if (input.target === "SKIPPED") {
      data.skipReasonCode = input.skipReasonCode!;
      data.skipReasonNote = input.reason.trim();
    }
    if (input.target === "FLAGGED") data.flagNotes = input.flagNote!.trim();
    if (input.target !== "SKIPPED" && task.status === "SKIPPED_PICKUP") data.noPickupRequired = false;
    // Blank stays as it is: never written as zero.
    if (input.weightKg != null) data.bagWeightKg = input.weightKg;
    if (input.price != null) data.dropoffCostAud = input.price;

    const updated = await tx.laundryTask.update({ where: { id: task.id }, data });
    const meta = {
      event: OFFICE_CORRECTION_EVENT,
      fromStatus: task.status,
      toStatus: plan.nextStatus,
      target: input.target,
      backwards: plan.backwards,
      happenedAt: input.happenedAt ?? null,
      pickedUpAt: plan.pickedUpAt?.toISOString() ?? null,
      droppedAt: plan.droppedAt?.toISOString() ?? null,
      doneById: doneBy?.id ?? null,
      doneByName: doneBy?.name ?? null,
      doneByRole: doneBy?.role ?? null,
      reason: input.reason.trim(),
      ...(input.bagCount != null ? { bagCount: input.bagCount } : {}),
      ...(input.weightKg != null ? { loadWeightKg: input.weightKg } : {}),
      ...(input.price != null ? { totalPrice: input.price } : {}),
      skipReasonCode: input.target === "SKIPPED" ? input.skipReasonCode : null,
      flagNote: input.target === "FLAGGED" ? input.flagNote : null,
      notifyTeam: input.notifyTeam === true,
      before,
    };
    await tx.laundryConfirmation.create({
      data: { laundryTaskId: task.id, confirmedById: actor.id, laundryReady: true, notes: JSON.stringify(meta) },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id, jobId: task.jobId, action: "LAUNDRY_OFFICE_CORRECTION", entity: "LaundryTask", entityId: task.id,
        before: before as Prisma.InputJsonValue,
        after: {
          status: plan.nextStatus, pickedUpAt: meta.pickedUpAt, droppedAt: meta.droppedAt, target: input.target, backwards: plan.backwards,
          reason: meta.reason, doneById: meta.doneById, bagCount: input.bagCount ?? null, weightKg: input.weightKg ?? null, price: input.price ?? null,
          actorRole: String(actor.role), actualActorId: actor.actualActorId ?? null, notifyTeam: meta.notifyTeam,
        },
      },
    });
    return { updated, plan, task };
  });

  const notice = input.notifyTeam
    ? await notifyTeam(actor, saved.task, `Office correction: ${saved.task.property.name}`, `The office corrected this run: ${stateName(saved.plan.nextStatus)}. Reason: ${input.reason.trim()}`, `laundry-office-correction:${saved.task.id}:${saved.updated.updatedAt.getTime()}`)
    : { requested: false, state: "not_requested" as const, recipients: 0 };

  return {
    taskId: saved.updated.id,
    status: saved.updated.status,
    updatedAt: saved.updated.updatedAt.toISOString(),
    backwards: saved.plan.backwards,
    changes: saved.plan.changes,
    notice,
  };
}

async function notifyTeam(actor: CorrectionActor, task: { id: string; jobId: string; supplierId: string | null; property: { accessInfo: unknown; laundryEnabled: boolean } }, subject: string, body: string, eventId: string): Promise<NoticeOutcome> {
  try {
    const [{ loadSupplierTeams, teamForRun }, { sendOfficeNotification }] = await Promise.all([import("./partners"), import("@/lib/notifications/office-sends")]);
    if (!task.supplierId) return { requested: true, state: "no_team", recipients: 0 };
    const teams = await loadSupplierTeams([task.supplierId]);
    const team = teamForRun(teams, task.supplierId, task.property);
    if (!team.length) return { requested: true, state: "no_team", recipients: 0 };
    // The partner team's existing request type, inbox only: an inbox notice
    // never turns into email, SMS or a phone push here.
    await sendOfficeNotification({
      typeKey: "laundry.team_request", eventKey: "laundry.team_request", eventId,
      entity: { type: "LaundryTask", id: task.id }, actorId: actor.id,
      scopeType: "LAUNDRY_TASK_SUPPLIER_TEAM", scopeId: () => task.id,
      category: "laundry", severity: "INFO", jobId: task.jobId,
      subject, body, url: `/v2/laundry/requests?task=${encodeURIComponent(task.id)}`,
      transports: ["INBOX"],
      recipients: team.map((member) => ({ id: member.id, role: member.role, name: member.name, email: member.email })),
      respectsPreferences: false,
      disabledTransports: [],
    });
    return { requested: true, state: "queued", recipients: team.length };
  } catch {
    return { requested: true, state: "failed", recipients: 0 };
  }
}

export type BulkOutcome = { taskId: string; ok: boolean; code?: string; message?: string };

export async function changeLaundryRunStates(actor: CorrectionActor, items: Array<{ taskId: string; expectedUpdatedAt: string }>, request: Omit<ChangeStateInput, "taskId" | "expectedUpdatedAt">): Promise<BulkOutcome[]> {
  const outcomes: BulkOutcome[] = [];
  for (const item of items) {
    try {
      await changeLaundryRunState(actor, { ...request, ...item });
      outcomes.push({ taskId: item.taskId, ok: true });
    } catch (error) {
      outcomes.push(refusalOutcome(item.taskId, error));
    }
  }
  return outcomes;
}

function refusalOutcome(taskId: string, error: unknown): BulkOutcome {
  if (error instanceof RunCorrectionError) return { taskId, ok: false, code: error.code, message: error.message };
  return { taskId, ok: false, code: "FAILED", message: "Not saved. Reload the run and try again." };
}

// ─────────────────────────────────────────────
// Void and Undo void
// ─────────────────────────────────────────────

export type VoidInput = { taskId: string; expectedUpdatedAt: string; reason: string; notifyTeam?: boolean };

export async function voidLaundryRun(actor: CorrectionActor, input: VoidInput, reports?: EmailedReportScope[], now: Date = new Date()) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new RunCorrectionError(400, "REASON_REQUIRED", "Give the reason for the void.");
  const scopes = reports ?? (await loadEmailedReportScopes());
  const saved = await db.$transaction(async (tx) => {
    const task = await lockRun(tx, input.taskId);
    checkVersion(task, input.expectedUpdatedAt);
    const report = emailedReportContaining(task, scopes);
    const refusal = voidRefusal({
      status: task.status, voidedAt: task.voidedAt, hasFailedPickup: hasFailedPickup(task.confirmations),
      onEmailedReport: Boolean(report), emailedReportLabel: report ? emailedReportLabel(report) : null,
    });
    if (refusal) throw new RunCorrectionError(refusal.status, refusal.code, refusal.message);
    const updated = await tx.laundryTask.update({
      where: { id: task.id },
      data: { status: "SKIPPED_PICKUP", voidedAt: now, voidedById: actor.id, voidReason: reason, voidPreviousStatus: task.status, notifyLaundry: false },
    });
    // Off every draft or active laundry route (as a soft delete does).
    const routes = await tx.laundryRoute.findMany({ where: { status: { in: ["ACTIVE", "DRAFT"] } }, select: { id: true, stops: true } });
    let strippedRoutes = 0;
    for (const route of routes) {
      const { stops, removed } = stripTaskFromStops(parseRouteStops(route.stops), task.id);
      if (!removed) continue;
      strippedRoutes += 1;
      await tx.laundryRoute.update({ where: { id: route.id }, data: { stops: stops as unknown as Prisma.InputJsonValue } });
    }
    await tx.laundryConfirmation.create({
      data: { laundryTaskId: task.id, confirmedById: actor.id, laundryReady: true, notes: JSON.stringify({ event: RUN_VOIDED_EVENT, reason, previousStatus: task.status, strippedRoutes }) },
    });
    const pending = pendingFailedPickupRequest(task.confirmations);
    if (pending) {
      const meta = parseNotes(pending.notes);
      await tx.laundryConfirmation.create({
        data: { laundryTaskId: task.id, confirmedById: actor.id, laundryReady: true, notes: JSON.stringify({ event: FAILED_PICKUP_VOIDED_EVENT, requestedAction: meta.requestedAction ?? null, reason: meta.reason ?? null, resolutionNotes: "Voided by office" }) },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actor.id, jobId: task.jobId, action: "LAUNDRY_RUN_VOIDED", entity: "LaundryTask", entityId: task.id,
        before: { status: task.status },
        after: { status: "SKIPPED_PICKUP", voided: true, reason, closedSkipRequest: Boolean(pending), actorRole: String(actor.role), actualActorId: actor.actualActorId ?? null },
      },
    });
    return { updated, task };
  });
  const notice = input.notifyTeam
    ? await notifyTeam(actor, saved.task, `Run cancelled by the office: ${saved.task.property.name}`, `The office voided this laundry run. Reason: ${reason}`, `laundry-run-void:${saved.task.id}:${saved.updated.updatedAt.getTime()}`)
    : { requested: false, state: "not_requested" as const, recipients: 0 };
  return { taskId: saved.updated.id, updatedAt: saved.updated.updatedAt.toISOString(), notice };
}

export async function voidLaundryRuns(actor: CorrectionActor, items: Array<{ taskId: string; expectedUpdatedAt: string }>, reason: string, notifyTeam = false): Promise<BulkOutcome[]> {
  const reports = await loadEmailedReportScopes();
  const outcomes: BulkOutcome[] = [];
  for (const item of items) {
    try {
      await voidLaundryRun(actor, { ...item, reason, notifyTeam }, reports);
      outcomes.push({ taskId: item.taskId, ok: true });
    } catch (error) {
      outcomes.push(refusalOutcome(item.taskId, error));
    }
  }
  return outcomes;
}

export async function undoLaundryRunVoid(actor: CorrectionActor, input: { taskId: string; expectedUpdatedAt: string; reason?: string | null }) {
  return db.$transaction(async (tx) => {
    const task = await lockRun(tx, input.taskId);
    checkVersion(task, input.expectedUpdatedAt);
    const refusal = undoVoidRefusal(task);
    if (refusal) throw new RunCorrectionError(refusal.status, refusal.code, refusal.message);
    const restored = task.voidPreviousStatus as LaundryStatus;
    const updated = await tx.laundryTask.update({
      where: { id: task.id },
      data: { status: restored, voidedAt: null, voidedById: null, voidReason: null, voidPreviousStatus: null },
    });
    const meta = { event: RUN_VOID_UNDONE_EVENT, restoredStatus: restored, voidedAt: task.voidedAt?.toISOString() ?? null, voidedById: task.voidedById, voidReason: task.voidReason, reason: input.reason?.trim() || null };
    await tx.laundryConfirmation.create({ data: { laundryTaskId: task.id, confirmedById: actor.id, laundryReady: true, notes: JSON.stringify(meta) } });
    await tx.auditLog.create({
      data: {
        userId: actor.id, jobId: task.jobId, action: "LAUNDRY_RUN_VOID_UNDONE", entity: "LaundryTask", entityId: task.id,
        before: { status: task.status, voidedAt: meta.voidedAt, voidedById: task.voidedById, voidReason: task.voidReason },
        after: { status: restored, actorRole: String(actor.role), actualActorId: actor.actualActorId ?? null, reason: meta.reason },
      },
    });
    return { taskId: updated.id, status: updated.status, updatedAt: updated.updatedAt.toISOString() };
  });
}

/**
 * The laundry team's own record arriving after an office correction already
 * recorded that leg (for example a pickup saved on a phone without signal):
 * kept beside the correction as its own row, with its photo, never applied
 * over it. Returns null when the run has no such correction.
 */
export async function keepTeamRecordBesideCorrection(
  actor: { id: string; role: Role | string },
  input: { taskId: string; leg: "PICKUP" | "DROP"; photoKey?: string | null; photoUrl?: string | null; bagCount?: number | null; notes?: string | null },
) {
  return db.$transaction(async (tx) => {
    const task = await lockRun(tx, input.taskId);
    const corrected = [...task.confirmations].reverse().find((row) => {
      const meta = parseNotes(row.notes);
      if (meta.event !== OFFICE_CORRECTION_EVENT) return false;
      return input.leg === "PICKUP" ? typeof meta.pickedUpAt === "string" : typeof meta.droppedAt === "string";
    });
    const legRecorded = input.leg === "PICKUP" ? Boolean(task.pickedUpAt) : Boolean(task.droppedAt);
    if (!corrected || !legRecorded) return null;
    const row = await tx.laundryConfirmation.create({
      data: {
        laundryTaskId: task.id, confirmedById: actor.id, laundryReady: true,
        s3Key: input.photoKey ?? null, photoUrl: input.photoUrl ?? null,
        notes: JSON.stringify({ event: TEAM_RECORD_AFTER_CORRECTION_EVENT, leg: input.leg, correctionId: corrected.id, ...(input.bagCount != null ? { bagCount: input.bagCount } : {}), notes: input.notes ?? null }),
      },
    });
    await tx.auditLog.create({
      data: { userId: actor.id, jobId: task.jobId, action: "LAUNDRY_TEAM_RECORD_KEPT_BESIDE_CORRECTION", entity: "LaundryTask", entityId: task.id, after: { leg: input.leg, confirmationId: row.id, correctionId: corrected.id } },
    });
    return { confirmationId: row.id };
  });
}
