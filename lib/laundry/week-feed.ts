/**
 * Shared laundry task feed query — the include + visibility rules behind
 * GET /api/laundry/week, reused by the route builder API and the plan brief so
 * every surface sees the same task shape and the same per-driver scoping.
 */
import { LaundryStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { propertyIsVisibleToLaundry } from "@/lib/laundry/teams";

export const laundryWeekTaskInclude = {
  property: {
    select: {
      id: true,
      name: true,
      address: true,
      suburb: true,
      latitude: true,
      longitude: true,
      linenBufferSets: true,
      accessInfo: true,
      laundryEnabled: true,
      // Key-lost mode: boards badge these tasks (same-day pickup+drop).
      keyLostMode: true,
      client: { select: { id: true, name: true, email: true } },
    },
  },
  supplier: {
    select: { id: true, name: true, pricePerKg: true, avgTurnaround: true },
  },
  job: { select: { scheduledDate: true, status: true } },
  confirmations: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.LaundryTaskInclude;

export type LaundryWeekTask = Prisma.LaundryTaskGetPayload<{
  include: typeof laundryWeekTaskInclude;
}>;

/** Apply LAUNDRY-role team scoping; ADMIN/OPS see everything. */
export function filterTasksVisibleToUser<T extends { property: { accessInfo: unknown; laundryEnabled: boolean | null } | null }>(
  tasks: T[],
  role: Role,
  userId: string,
): T[] {
  if (role !== Role.LAUNDRY) return tasks;
  return tasks.filter((task) => propertyIsVisibleToLaundry(task.property, userId));
}

/**
 * The week feed query: tasks whose pickup or drop-off falls in [start, end),
 * plus FLAGGED tasks regardless of window, filtered to the caller's teams.
 */
export async function fetchLaundryWeekTasks(
  start: Date,
  end: Date,
  viewer: { role: Role; userId: string },
): Promise<LaundryWeekTask[]> {
  const tasks = await db.laundryTask.findMany({
    where: {
      OR: [
        { pickupDate: { gte: start, lt: end } },
        { dropoffDate: { gte: start, lt: end } },
        { status: "FLAGGED" },
      ],
    },
    include: laundryWeekTaskInclude,
    orderBy: { pickupDate: "asc" },
  });
  return filterTasksVisibleToUser(tasks, viewer.role, viewer.userId);
}

/**
 * Route-builder candidate window: everything due today or tomorrow plus
 * OVERDUE work (scheduled before today, not yet done/skipped), team-scoped.
 * `todayStart`/`dayAfterTomorrow` are UTC instants bounding the Sydney days.
 */
export async function fetchLaundryRouteCandidates(
  todayStart: Date,
  dayAfterTomorrow: Date,
  viewer: { role: Role; userId: string },
  overdueCap = 20,
): Promise<{ current: LaundryWeekTask[]; overdue: LaundryWeekTask[] }> {
  const activeStatuses: LaundryStatus[] = [
    LaundryStatus.PENDING,
    LaundryStatus.CONFIRMED,
    LaundryStatus.PICKED_UP,
    LaundryStatus.FLAGGED,
  ];
  const [current, overdueRaw] = await Promise.all([
    db.laundryTask.findMany({
      where: {
        OR: [
          { pickupDate: { gte: todayStart, lt: dayAfterTomorrow } },
          { dropoffDate: { gte: todayStart, lt: dayAfterTomorrow } },
        ],
      },
      include: laundryWeekTaskInclude,
      orderBy: { pickupDate: "asc" },
    }),
    db.laundryTask.findMany({
      where: {
        status: { in: activeStatuses },
        OR: [
          {
            pickupDate: { lt: todayStart },
            status: { in: [LaundryStatus.PENDING, LaundryStatus.CONFIRMED, LaundryStatus.FLAGGED] },
          },
          { dropoffDate: { lt: todayStart } },
        ],
      },
      include: laundryWeekTaskInclude,
      orderBy: { dropoffDate: "asc" },
      take: overdueCap * 2, // filtered per-team below, then capped
    }),
  ]);

  const currentIds = new Set(current.map((t) => t.id));
  const visibleCurrent = filterTasksVisibleToUser(current, viewer.role, viewer.userId);
  const visibleOverdue = filterTasksVisibleToUser(
    overdueRaw.filter((t) => !currentIds.has(t.id)),
    viewer.role,
    viewer.userId,
  ).slice(0, overdueCap);

  return { current: visibleCurrent, overdue: visibleOverdue };
}
