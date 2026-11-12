import "server-only";
/**
 * Builds the admin Laundry Pipeline for one Sydney day: the runs in each lane
 * (lib/laundry/pipeline rules), their exceptions, the driver carrying each stop
 * (from that day's laundry routes), the next guest from the job's reservation
 * context, today's three stat figures and the Approvals laundry count.
 */
import { loadSupplierTeams, teamForRun, type SupplierTeamMember } from "./partners";
import type { SupplierTeamSummary } from "./nudge-rules";
import { loadTeamReplies, repliesByTask } from "./team-request-replies";
import type { TeamReplySummary } from "./team-request-reply-rules";
import { LaundryStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { parseRouteStops } from "@/lib/laundry/route-plan";
import { filterTasksVisibleToUser, laundryWeekTaskInclude, withHandoffActorNames } from "@/lib/laundry/week-feed";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { buildGuestSummary } from "@/lib/jobs/guest-summary";
import {
  PIPELINE_LANES,
  classifyLane,
  dayKeyOf,
  daysBetweenKeys,
  detectExceptions,
  latestBagCount,
  latestReadiness,
  type PipelineException,
  type PipelineLane,
  type PipelineSettings,
} from "@/lib/laundry/pipeline";

export const PIPELINE_TASK_CAP = 500;

const pipelineInclude = {
  ...laundryWeekTaskInclude,
  job: {
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      status: true,
      internalNotes: true,
      assignments: { where: { removedAt: null }, orderBy: { isPrimary: "desc" as const }, select: { user: { select: { name: true } } } },
    },
  },
} satisfies Prisma.LaundryTaskInclude;

export type PipelineFilters = { q?: string | null; supplierId?: string | null; driverId?: string | null };

export type PipelineDriverStop = { driverId: string; driverName: string; stop: number; kind: "PICKUP" | "DROP" };

export type PipelineCard = Record<string, unknown> & {
  id: string;
  status: string;
  updatedAt: string;
  lane: PipelineLane;
  carriedIn: boolean;
  exceptions: PipelineException[];
  readiness: boolean | null;
  bagCount: number | null;
  driver: PipelineDriverStop | null;
  /** Day n of the planned m days at the laundry (At the laundry lane only). */
  dayOf: { day: number; planned: number } | null;
  nextGuest: { checkinAt: string | null; name: string | null } | null;
  cleaners: string[];
  /** The run's laundry partner team who can be asked (null when the run has no supplier). */
  supplierTeam: SupplierTeamSummary;
  /** The laundry team's answers to office requests (newest first, last 14 days). */
  teamReplies: TeamReplySummary[];
};

export type PipelineResponse = {
  date: string;
  today: string;
  lanes: Record<PipelineLane, PipelineCard[]>;
  counts: Record<PipelineLane, number>;
  /** The whole day, before search and filters: pickups, drops, runs with an exception. */
  summary: { pickups: number; drops: number; exceptions: number };
  tiles: { runsToday: number; inTransit: number; deliveredToday: number };
  drivers: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  approvalsFlagged: number;
  settings: PipelineSettings;
  truncated: boolean;
  generatedAt: string;
};

function matchesSearch(task: { id: string; property?: unknown; supplier?: unknown }, q: string): boolean {
  const property = (task.property ?? {}) as { name?: string | null; suburb?: string | null; address?: string | null; client?: { name?: string | null } | null };
  const supplier = (task.supplier ?? {}) as { name?: string | null };
  const haystack = [task.id, property.name, property.suburb, property.address, property.client?.name, supplier.name].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q.toLowerCase());
}

/** Names only: the screen shows who will be asked, never their contact details. */
function supplierTeamSummary(
  task: { supplierId: string | null; supplier: { name: string } | null; property: { accessInfo?: unknown; laundryEnabled?: boolean | null } | null; confirmations: Array<{ notes: string | null; confirmedById: string }> },
  teams: Map<string, SupplierTeamMember[]>,
): SupplierTeamSummary {
  if (!task.supplierId || !task.supplier) return null;
  const members = teamForRun(teams, task.supplierId, task.property);
  const delivererId = lastDropActorId(task.confirmations);
  const deliverer = delivererId ? members.find((member) => member.id === delivererId) : undefined;
  return {
    supplierName: task.supplier.name,
    count: members.length,
    names: members.map((member) => member.name?.trim() || "Laundry team member"),
    deliverer: deliverer ? deliverer.name?.trim() || "the team member" : null,
  };
}

/** Who recorded the latest drop-off (DROPPED event), the same rule the send uses. */
function lastDropActorId(confirmations: ReadonlyArray<{ notes: string | null; confirmedById: string }>): string | null {
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    try {
      const meta = JSON.parse(confirmations[index].notes ?? "") as { event?: unknown };
      if (meta?.event === "DROPPED") return confirmations[index].confirmedById;
    } catch {
      /* not an event row */
    }
  }
  return null;
}

async function loadDriverStops(dayKey: string): Promise<{ byTask: Map<string, PipelineDriverStop>; drivers: Array<{ id: string; name: string }> }> {
  const routes = await db.laundryRoute.findMany({
    where: { date: { gte: sydneyDayStart(dayKey), lt: sydneyDayStart(addDaysToKey(dayKey, 1)) }, status: { not: "ABANDONED" } },
    select: { userId: true, stops: true, user: { select: { name: true } } },
  });
  const byTask = new Map<string, PipelineDriverStop>();
  const drivers = new Map<string, string>();
  for (const route of routes) {
    const name = route.user?.name?.trim() || "Driver";
    drivers.set(route.userId, name);
    const stops = [...parseRouteStops(route.stops)].sort((a, b) => a.order - b.order);
    stops.forEach((stop, index) => {
      if (!byTask.has(stop.taskId)) byTask.set(stop.taskId, { driverId: route.userId, driverName: name, stop: index + 1, kind: stop.kind });
    });
  }
  return { byTask, drivers: Array.from(drivers, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function loadLaundryPipeline(
  dayKey: string,
  filters: PipelineFilters,
  viewer: { role: Role; userId: string },
  now = new Date(),
): Promise<PipelineResponse> {
  const todayKey = sydneyTodayKey(now);
  const dayStart = sydneyDayStart(dayKey);
  const nextStart = sydneyDayStart(addDaysToKey(dayKey, 1));
  const todayStart = sydneyDayStart(todayKey);
  const tomorrowStart = sydneyDayStart(addDaysToKey(todayKey, 1));
  const appSettings = await getAppSettings();
  const settings: PipelineSettings = {
    maxOutdoorDays: appSettings.laundryOperations?.maxOutdoorDays ?? 3,
    requireDropoffPhoto: appSettings.laundryPortalVisibility?.requireDropoffPhoto === true,
  };

  const or: Prisma.LaundryTaskWhereInput[] = [
    { pickupDate: { gte: dayStart, lt: nextStart } },
    { dropoffDate: { gte: dayStart, lt: nextStart } },
    { droppedAt: { gte: dayStart, lt: nextStart } },
    { status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.READY_TO_RETURN] }, pickupDate: { lt: nextStart } },
  ];
  if (dayKey === todayKey) {
    or.push({ status: { in: [LaundryStatus.PENDING, LaundryStatus.CONFIRMED, LaundryStatus.FLAGGED] }, pickupDate: { lt: dayStart } });
  }

  const [rawTasks, stops, runsToday, inTransit, deliveredToday, approvalsFlagged, suppliers] = await Promise.all([
    db.laundryTask.findMany({ where: { OR: or }, include: pipelineInclude, orderBy: { pickupDate: "asc" }, take: PIPELINE_TASK_CAP + 1 }),
    loadDriverStops(dayKey),
    db.laundryTask.count({ where: { OR: [{ pickupDate: { gte: todayStart, lt: tomorrowStart } }, { dropoffDate: { gte: todayStart, lt: tomorrowStart } }] } }),
    // In transit = picked up and not delivered, including "Ready to return".
    db.laundryTask.count({ where: { status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.READY_TO_RETURN] } } }),
    db.laundryTask.count({ where: { status: LaundryStatus.DROPPED, droppedAt: { gte: todayStart, lt: tomorrowStart } } }),
    db.laundryTask.count({ where: { status: LaundryStatus.FLAGGED } }),
    db.laundrySupplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const truncated = rawTasks.length > PIPELINE_TASK_CAP;
  const visible = await withHandoffActorNames(filterTasksVisibleToUser(rawTasks.slice(0, PIPELINE_TASK_CAP), viewer.role, viewer.userId));
  const [teams, replyRows] = await Promise.all([
    loadSupplierTeams(visible.map((task) => task.supplierId ?? "").filter(Boolean)),
    loadTeamReplies({ taskIds: visible.map((task) => task.id) }, 14, now).catch(() => []),
  ]);
  const replies = repliesByTask(replyRows);

  const all: PipelineCard[] = [];
  for (const task of visible) {
    const placement = classifyLane(task, dayKey, todayKey);
    if (!placement) continue;
    const { job, ...rest } = task;
    const arriving = job ? buildGuestSummary(parseJobInternalNotes(job.internalNotes).reservationContext) : null;
    const pickedKey = dayKeyOf(task.pickedUpAt) ?? dayKeyOf(task.pickupDate);
    const dropKey = dayKeyOf(task.dropoffDate);
    all.push({
      ...rest,
      // The job without its internal notes: only what the run card shows.
      job: job ? { id: job.id, jobNumber: job.jobNumber, scheduledDate: job.scheduledDate, status: job.status } : null,
      updatedAt: task.updatedAt.toISOString(),
      lane: placement.lane,
      carriedIn: placement.carriedIn,
      exceptions: detectExceptions(task, { todayKey, now, settings }),
      readiness: latestReadiness(task.confirmations),
      bagCount: latestBagCount(task.confirmations),
      driver: stops.byTask.get(task.id) ?? null,
      dayOf:
        placement.lane === "laundry" && pickedKey && dropKey
          ? { day: daysBetweenKeys(pickedKey, dayKey) + 1, planned: Math.max(1, daysBetweenKeys(pickedKey, dropKey)) }
          : null,
      nextGuest: arriving?.hasAnything ? { checkinAt: arriving.checkinAtLocal, name: arriving.name } : null,
      cleaners: job?.assignments.map((row) => row.user.name?.trim() || "Cleaner") ?? [],
      supplierTeam: supplierTeamSummary(task, teams),
      teamReplies: replies.get(task.id) ?? [],
    });
  }

  const q = filters.q?.trim() ?? "";
  const filtered = all.filter((card) => {
    if (q && !matchesSearch(card, q)) return false;
    if (filters.supplierId && (card.supplier as { id?: string } | null)?.id !== filters.supplierId) return false;
    if (filters.driverId === "__none" && card.driver) return false;
    if (filters.driverId && filters.driverId !== "__none" && card.driver?.driverId !== filters.driverId) return false;
    return true;
  });

  const lanes = Object.fromEntries(PIPELINE_LANES.map((lane) => [lane, [] as PipelineCard[]])) as Record<PipelineLane, PipelineCard[]>;
  for (const card of filtered) lanes[card.lane].push(card);
  const counts = Object.fromEntries(PIPELINE_LANES.map((lane) => [lane, lanes[lane].length])) as Record<PipelineLane, number>;

  return {
    date: dayKey,
    today: todayKey,
    lanes,
    counts,
    summary: {
      pickups: all.filter((card) => card.lane === "pickup").length,
      drops: all.filter((card) => card.lane === "drop").length,
      exceptions: all.filter((card) => card.exceptions.length > 0).length,
    },
    tiles: { runsToday, inTransit, deliveredToday },
    drivers: stops.drivers,
    suppliers,
    approvalsFlagged,
    settings,
    truncated,
    generatedAt: now.toISOString(),
  };
}
