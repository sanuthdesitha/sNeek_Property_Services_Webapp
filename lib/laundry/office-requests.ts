import "server-only";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { detectExceptions, latestReadiness } from "./pipeline";
import { LAUNDRY_TEAM_REQUEST_KINDS, TEAM_REQUEST_LABELS, laundryTeamRequestKinds, type LaundryTeamRequestKind } from "./nudge-rules";
import { laundryTaskScope } from "./teams";

/**
 * "Requests from the office" on the laundry portal Today page: the "Ask
 * laundry team" requests (audit LAUNDRY_TEAM_REQUEST_SENT) addressed to this
 * person in the last few days, for runs they can still see. A request is
 * "Open" while the run still calls for it under the same Pipeline rules the
 * office used, otherwise "Done" (the team answered through the run's existing
 * pickup / drop-off / photo actions, or the office changed the run).
 */
export const OFFICE_REQUEST_WINDOW_HOURS = 72;

export type LaundryOfficeRequest = {
  id: string;
  taskId: string;
  kind: LaundryTeamRequestKind;
  label: string;
  text: string;
  note: string | null;
  askedAtLabel: string;
  propertyName: string;
  open: boolean;
};

/** How the request reads to the laundry team. */
const PORTAL_TITLES: Record<LaundryTeamRequestKind, string> = {
  TEAM_CONFIRM_PICKUP: "Confirm the pickup",
  TEAM_CONFIRM_DROP: "Confirm the drop-off",
  TEAM_RETURN_ETA: "When will it be back?",
  TEAM_PHOTO: "Add the drop-off photo",
};

function isRequestKind(value: unknown): value is LaundryTeamRequestKind {
  return typeof value === "string" && (LAUNDRY_TEAM_REQUEST_KINDS as readonly string[]).includes(value);
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
  const tasks = await db.laundryTask.findMany({
    where: { ...scope, id: { in: taskIds } },
    select: {
      id: true, jobId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, flagReason: true,
      supplier: { select: { avgTurnaround: true } },
      property: { select: { name: true, suburb: true } },
      job: { select: { status: true } },
      confirmations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { laundryReady: true, photoUrl: true, notes: true, createdAt: true } },
    },
  });
  const settings = await getAppSettings().catch(() => null);
  const zone = settings?.timezone || "Australia/Sydney";
  const pipeline = { maxOutdoorDays: settings?.laundryOperations?.maxOutdoorDays ?? 3, requireDropoffPhoto: settings?.laundryPortalVisibility?.requireDropoffPhoto === true };
  const todayKey = sydneyTodayKey(now);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const out: LaundryOfficeRequest[] = [];
  for (const row of rows) {
    const task = row.entityId ? byId.get(row.entityId) : undefined;
    const after = (row.after ?? {}) as { kind?: unknown; note?: unknown };
    if (!task || !isRequestKind(after.kind)) continue;
    const applicable = laundryTeamRequestKinds({
      status: task.status, pickupDate: task.pickupDate, dropoffDate: task.dropoffDate,
      exceptions: detectExceptions(task, { todayKey, now, settings: pipeline }),
      readiness: latestReadiness(task.confirmations), jobStatus: task.job?.status ?? null, hasJob: Boolean(task.jobId), hasSupplier: true,
    }, todayKey);
    const label = TEAM_REQUEST_LABELS[after.kind];
    out.push({
      id: row.id,
      taskId: task.id,
      kind: after.kind,
      label: PORTAL_TITLES[after.kind],
      text: label.text,
      note: typeof after.note === "string" && after.note.trim() ? after.note.trim() : null,
      askedAtLabel: formatInTimeZone(row.createdAt, zone, "EEE d MMM HH:mm"),
      propertyName: task.property?.suburb ? `${task.property.name}, ${task.property.suburb}` : task.property?.name ?? "Property",
      open: applicable.includes(after.kind),
    });
  }
  return out;
}
