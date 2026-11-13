/**
 * Shared laundry task feed query — the include + visibility rules behind
 * GET /api/laundry/week, reused by the route builder API and the plan brief so
 * every surface sees the same task shape and the same per-driver scoping.
 */
import { NOT_VOIDED } from "./void-scope";
import { accessAudienceMatches } from "@/lib/properties/access-guide";
import { LaundryStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { isLaundryOfficeRole, propertyIsVisibleToLaundry } from "@/lib/laundry/teams";

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
      accessGuide: true,
      laundryEnabled: true,
      // Key-lost mode: boards badge these tasks (same-day pickup+drop).
      keyLostMode: true,
      client: { select: { id: true, name: true, email: true } },
    },
  },
  supplier: {
    select: {
      id: true, name: true, pricePerKg: true, avgTurnaround: true,
      // Usual schedule (descriptive defaults, 2026-11-13): shown when planning.
      pickupWeekdays: true, pickupWindowStart: true, pickupWindowEnd: true,
      dropWeekdays: true, dropWindowStart: true, dropWindowEnd: true,
    },
  },
  job: { select: { scheduledDate: true, status: true } },
  confirmations: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.LaundryTaskInclude;

export type LaundryWeekTask = Prisma.LaundryTaskGetPayload<{
  include: typeof laundryWeekTaskInclude;
}>;

/** Resolve names only after task visibility has been established; never expose user profiles. */
export async function withHandoffActorNames<T extends { confirmations: Array<{ confirmedById: string }> }>(tasks: T[]) {
  const ids = Array.from(new Set(tasks.flatMap(task => task.confirmations.map(row => row.confirmedById))));
  const names = new Map<string, string | null>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const users = await db.user.findMany({ where: { id: { in: ids.slice(offset, offset + 200) } }, select: { id: true, name: true } });
    for (const user of users) names.set(user.id, user.name);
  }
  return tasks.map(task => ({ ...task, confirmations: task.confirmations.map(row => ({ ...row, confirmedByName: names.get(row.confirmedById) ?? null })) }));
}

/** Apply LAUNDRY-role team scoping; ADMIN/OPS see everything. */
export function filterTasksVisibleToUser<T extends { property: { accessInfo: unknown; laundryEnabled: boolean | null } | null; voidedAt?: Date | null }>(
  tasks: T[],
  role: Role,
  userId: string,
): T[] {
  if (isLaundryOfficeRole(role)) return tasks;
  return tasks
    // A run the office voided is gone from the laundry portal (2026-11-14).
    .filter((task) => !task.voidedAt)
    .filter((task) => propertyIsVisibleToLaundry(task.property, userId))
    .map((task) => redactPropertyForLaundry(task));
}

/**
 * What leaves the server for a laundry viewer.
 *
 * The access guide carries an audience per entry. The browser used to receive
 * every entry (lockbox, alarm, key and Wi-Fi steps meant for the cleaner) and
 * hide the wrong ones itself, so the property's "laundry access is the same as
 * the cleaner's" setting was only a display preference. The audience rule is
 * applied here instead, and the client's email address is not sent at all.
 */
function redactPropertyForLaundry<T extends { property: unknown }>(task: T): T {
  const property = task.property;
  if (!property || typeof property !== "object") return task;
  const source = property as Record<string, unknown>;
  const info =
    source.accessInfo && typeof source.accessInfo === "object" && !Array.isArray(source.accessInfo)
      ? (source.accessInfo as Record<string, unknown>)
      : {};
  const redacted: Record<string, unknown> = { ...source };
  if ("accessGuide" in source) {
    const entries = Array.isArray(source.accessGuide) ? source.accessGuide : [];
    redacted.accessGuide = entries.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        accessAudienceMatches(
          (entry as { audience?: unknown }).audience,
          "LAUNDRY",
          info.laundrySameAsCleaner === true,
        ),
    );
  }
  if (source.client && typeof source.client === "object") {
    const { email: _email, ...client } = source.client as Record<string, unknown>;
    redacted.client = client;
  }
  return { ...task, property: redacted };
}

/**
 * The week feed query: tasks whose pickup or drop-off falls in [start, end),
 * plus FLAGGED tasks regardless of window, filtered to the caller's teams.
 */
export async function fetchLaundryWeekTasks(
  start: Date,
  end: Date,
  viewer: { role: Role; userId: string },
  /** The page's own viewer scope (`laundryTaskScope`), applied as well; the API passes none. */
  scope: Prisma.LaundryTaskWhereInput = {},
  /** Voided runs (2026-11-14): left out unless an office viewer asks for them (Completed history, Voided filter). */
  options: { includeVoided?: boolean } = {},
): Promise<LaundryWeekTask[]> {
  const includeVoided = options.includeVoided === true && isLaundryOfficeRole(viewer.role);
  const tasks = await db.laundryTask.findMany({
    where: {
      ...scope,
      ...(includeVoided ? {} : NOT_VOIDED),
      OR: [
        { pickupDate: { gte: start, lt: end } },
        { dropoffDate: { gte: start, lt: end } },
        { status: "FLAGGED" },
      ],
    },
    include: laundryWeekTaskInclude,
    orderBy: { pickupDate: "asc" },
  });
  return withHandoffActorNames(filterTasksVisibleToUser(tasks, viewer.role, viewer.userId));
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
    // A "Ready to return" set still has its drop ahead (2026-11-13).
    LaundryStatus.READY_TO_RETURN,
    LaundryStatus.FLAGGED,
  ];
  const [current, overdueRaw] = await Promise.all([
    db.laundryTask.findMany({
      where: {
        ...NOT_VOIDED,
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
