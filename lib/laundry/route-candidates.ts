/**
 * Route-builder candidate derivation (server-side): which (taskId, kind) pairs
 * a driver may put on a route for a given day — due today, due tomorrow
 * (pull-forward), and OVERDUE work — plus the day-key helpers the route API,
 * plan brief and dashboard share.
 */
import { Role } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";
import {
  fetchLaundryRouteCandidates,
  type LaundryWeekTask,
} from "@/lib/laundry/week-feed";
import type { RouteStopKind } from "@/lib/laundry/route-plan";

const TZ = "Australia/Sydney";
const DAY_MS = 86_400_000;
export const ROUTE_OVERDUE_CAP = 20;

/** UTC-midnight key for the Sydney calendar day containing `value`. */
export function sydneyDayKey(value: Date = new Date()): Date {
  const zoned = toZonedTime(value, TZ);
  return new Date(Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()));
}

export type CandidateBucket = "TODAY" | "TOMORROW" | "OVERDUE";

export type RouteCandidate = {
  taskId: string;
  kind: RouteStopKind;
  bucket: CandidateBucket;
  dueDate: string;
  overdueDays: number;
  propertyId: string;
  propertyName: string;
  suburb: string | null;
  status: string;
  keyLostMode: boolean;
  lat: number | null;
  lng: number | null;
  scheduledAt: string;
};

const PICKUP_OPEN_STATUSES = ["PENDING", "CONFIRMED"];
const DROP_CLOSED_STATUSES = ["DROPPED", "SKIPPED_PICKUP"];

function bucketFor(dueKey: Date, todayKey: Date): CandidateBucket | null {
  const diff = Math.floor((dueKey.getTime() - todayKey.getTime()) / DAY_MS);
  if (diff < 0) return "OVERDUE";
  if (diff === 0) return "TODAY";
  if (diff === 1) return "TOMORROW";
  return null;
}

function candidateFromTask(
  task: LaundryWeekTask,
  kind: RouteStopKind,
  due: Date,
  todayKey: Date,
): RouteCandidate | null {
  const dueKey = sydneyDayKey(due);
  const bucket = bucketFor(dueKey, todayKey);
  if (!bucket) return null;
  const prop = task.property;
  return {
    taskId: task.id,
    kind,
    bucket,
    dueDate: due.toISOString(),
    overdueDays:
      bucket === "OVERDUE" ? Math.floor((todayKey.getTime() - dueKey.getTime()) / DAY_MS) : 0,
    propertyId: task.propertyId,
    propertyName: prop?.name ?? "Unknown property",
    suburb: prop?.suburb ?? null,
    status: task.status,
    keyLostMode: Boolean((prop as { keyLostMode?: boolean | null } | null)?.keyLostMode),
    lat: typeof prop?.latitude === "number" ? prop.latitude : null,
    lng: typeof prop?.longitude === "number" ? prop.longitude : null,
    scheduledAt: due.toISOString(),
  };
}

/** Derive the (taskId, kind) candidate list from a set of visible tasks. */
export function deriveCandidates(tasks: LaundryWeekTask[], todayKey: Date): RouteCandidate[] {
  const out: RouteCandidate[] = [];
  for (const task of tasks) {
    if (!task.noPickupRequired && PICKUP_OPEN_STATUSES.includes(task.status)) {
      const c = candidateFromTask(task, "PICKUP", task.pickupDate, todayKey);
      if (c) out.push(c);
    }
    if (!DROP_CLOSED_STATUSES.includes(task.status)) {
      const c = candidateFromTask(task, "DROP", task.dropoffDate, todayKey);
      if (c) out.push(c);
    }
  }
  return out;
}

export async function loadCandidatesAndTasks(
  todayKey: Date,
  viewer: { role: Role; userId: string },
): Promise<{ candidates: RouteCandidate[]; tasks: LaundryWeekTask[] }> {
  const dayAfterTomorrow = new Date(todayKey.getTime() + 2 * DAY_MS);
  const { current, overdue } = await fetchLaundryRouteCandidates(
    todayKey,
    dayAfterTomorrow,
    viewer,
    ROUTE_OVERDUE_CAP,
  );
  const all = [...current, ...overdue];
  const candidates = deriveCandidates(all, todayKey);
  const referenced = new Set(candidates.map((c) => c.taskId));
  return { candidates, tasks: all.filter((t) => referenced.has(t.id)) };
}
