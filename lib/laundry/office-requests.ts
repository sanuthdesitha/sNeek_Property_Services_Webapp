import "server-only";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { detectExceptions, latestReadiness } from "./pipeline";
import { LAUNDRY_TEAM_REQUEST_KINDS, TEAM_REQUEST_LABELS, laundryTeamRequestKinds, type LaundryTeamRequestKind } from "./nudge-rules";
import { laundryTaskScope } from "./teams";
import { ANSWERS_BY_KIND, answerClearsRequest } from "./team-request-reply-rules";
import { loadTeamReplies, toReplySummary } from "./team-request-replies";
import { OFFICE_REQUEST_BADGES, type LaundryOfficeRequest, type OfficeRequestState } from "./office-request-types";

export type { LaundryOfficeRequest } from "./office-request-types";

/**
 * "From the office" in the laundry portal: the "Ask laundry team" requests
 * (audit LAUNDRY_TEAM_REQUEST_SENT) addressed to this person in the last few
 * days, for runs they can still see. State:
 * - answered: a typed answer that settles it was given (LaundryTeamRequestReply);
 * - done: the run no longer calls for it under the same Pipeline rules the
 *   office used (the team did the run's own action, or the office changed it);
 * - open: otherwise.
 */
export const OFFICE_REQUEST_WINDOW_HOURS = 72;

function isRequestKind(value: unknown): value is LaundryTeamRequestKind {
  return typeof value === "string" && (LAUNDRY_TEAM_REQUEST_KINDS as readonly string[]).includes(value);
}

const PICKUP_KINDS = new Set<LaundryTeamRequestKind>(["TEAM_CONFIRM_PICKUP", "TEAM_MOVE_PICKUP"]);

function requestTitle(kind: LaundryTeamRequestKind, propertyName: string, proposedTime: string | null, plannedTime: string | null): string {
  switch (kind) {
    case "TEAM_PHOTO":
      return `${propertyName} drop-off`;
    case "TEAM_MOVE_PICKUP":
      return proposedTime ? `${propertyName} moved to ${proposedTime}` : `${propertyName} pickup later today?`;
    case "TEAM_CONFIRM_PICKUP":
      return `${propertyName} pickup${plannedTime ? `, ${plannedTime}` : ""}`;
    case "TEAM_CONFIRM_DROP":
      return `${propertyName} drop-off time`;
    case "TEAM_RETURN_ETA":
    default:
      return `${propertyName} set, when back?`;
  }
}

export async function listOfficeRequestsForLaundryUser(viewer: { id: string; role: Role | string }, now = new Date()): Promise<LaundryOfficeRequest[]> {
  if (viewer.role !== Role.LAUNDRY) return [];
  const since = new Date(now.getTime() - OFFICE_REQUEST_WINDOW_HOURS * 3_600_000);
  const rows = await db.auditLog.findMany({
    where: { action: "LAUNDRY_TEAM_REQUEST_SENT", entity: "LaundryTask", createdAt: { gte: since }, after: { path: ["recipientIds"], array_contains: [viewer.id] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, entityId: true, createdAt: true, after: true },
  });
  if (!rows.length) return [];
  const scope = await laundryTaskScope(viewer);
  const taskIds = Array.from(new Set(rows.map((row) => row.entityId).filter((id): id is string => Boolean(id))));
  const [tasks, replyRows] = await Promise.all([
    db.laundryTask.findMany({
      where: { ...scope, id: { in: taskIds } },
      select: {
        id: true, jobId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, flagReason: true, pickupTime: true, dropoffTime: true,
        supplier: { select: { avgTurnaround: true } },
        property: { select: { name: true, suburb: true } },
        job: { select: { status: true } },
        confirmations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { laundryReady: true, photoUrl: true, notes: true, createdAt: true } },
      },
    }),
    loadTeamReplies({ requestIds: rows.map((row) => row.id) }, 7, now),
  ]);
  const settings = await getAppSettings().catch(() => null);
  const zone = settings?.timezone || "Australia/Sydney";
  const pipeline = { maxOutdoorDays: settings?.laundryOperations?.maxOutdoorDays ?? 3, requireDropoffPhoto: settings?.laundryPortalVisibility?.requireDropoffPhoto === true };
  const todayKey = sydneyTodayKey(now);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const repliesByRequest = new Map<string, typeof replyRows>();
  for (const reply of replyRows) repliesByRequest.set(reply.requestAuditId, [...(repliesByRequest.get(reply.requestAuditId) ?? []), reply]);

  // Oldest first, to number repeated requests of a kind for a run ("Reminder 2").
  const counter = new Map<string, number>();
  const reminders = new Map<string, number>();
  for (const row of [...rows].reverse()) {
    const kind = (row.after as { kind?: unknown } | null)?.kind;
    const key = `${row.entityId}:${String(kind)}`;
    counter.set(key, (counter.get(key) ?? 0) + 1);
    reminders.set(row.id, counter.get(key) ?? 1);
  }

  const out: LaundryOfficeRequest[] = [];
  for (const row of rows) {
    const task = row.entityId ? byId.get(row.entityId) : undefined;
    const after = (row.after ?? {}) as { kind?: unknown; note?: unknown; proposedTime?: unknown };
    if (!task || !isRequestKind(after.kind)) continue;
    const kind = after.kind;
    const applicable = laundryTeamRequestKinds({
      status: task.status, pickupDate: task.pickupDate, dropoffDate: task.dropoffDate,
      exceptions: detectExceptions(task, { todayKey, now, settings: pipeline }),
      readiness: latestReadiness(task.confirmations), jobStatus: task.job?.status ?? null, hasJob: Boolean(task.jobId), hasSupplier: true,
    }, todayKey);
    const replies = (repliesByRequest.get(row.id) ?? []).map(toReplySummary);
    const state: OfficeRequestState = replies.some((reply) => answerClearsRequest(reply.answer)) ? "answered" : applicable.includes(kind) ? "open" : "done";
    const propertyName = task.property?.name ?? "Property";
    const proposedTime = typeof after.proposedTime === "string" ? after.proposedTime : null;
    const stopKind = PICKUP_KINDS.has(kind) ? "PICKUP" : "DROP";
    const plannedTime = stopKind === "PICKUP" ? task.pickupTime : task.dropoffTime;
    out.push({
      id: row.id,
      taskId: task.id,
      kind,
      badge: OFFICE_REQUEST_BADGES[kind].label,
      title: requestTitle(kind, propertyName, proposedTime, plannedTime),
      text: TEAM_REQUEST_LABELS[kind].text,
      note: typeof after.note === "string" && after.note.trim() ? after.note.trim() : null,
      askedAtLabel: formatInTimeZone(row.createdAt, zone, "EEE d MMM HH:mm"),
      askedAt: row.createdAt.toISOString(),
      propertyName: task.property?.suburb ? `${propertyName}, ${task.property.suburb}` : propertyName,
      state,
      reminderNumber: reminders.get(row.id) ?? 1,
      proposedTime,
      plannedTime,
      stopKind,
      answers: ANSWERS_BY_KIND[kind],
      replies,
    });
  }
  return out;
}

export function openRequestCount(requests: readonly LaundryOfficeRequest[]): number {
  return requests.filter((request) => request.state === "open").length;
}
