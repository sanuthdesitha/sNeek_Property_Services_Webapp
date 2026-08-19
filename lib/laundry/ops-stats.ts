/**
 * Laundry operations statistics — the pure computation behind
 * /v2/admin/laundry/stats.
 *
 * Extracted from the page because every number here is a Sydney-calendar
 * judgement, and those are exactly the rules that rot silently. "On time" is
 * not `droppedAt <= dropoffDate`: dropoffDate is a stored UTC instant standing
 * for a Sydney DAY, so the honest comparison is against the END of that day in
 * Sydney. v1 used date-fns `endOfDay`, which reads the SERVER's timezone — on a
 * UTC host that is 09:59 the next morning in Sydney, quietly forgiving a full
 * extra morning. Weeks have the same problem in the other direction: a bag
 * dropped at 9am Monday Sydney is 23:00 Sunday UTC, i.e. the previous week.
 *
 * `todayKey` is a parameter rather than read from the clock so the whole thing
 * is deterministic under test. See lib/time/sydney-range.ts for the helpers.
 *
 * Not to be confused with lib/accountability/laundry-stats.ts, which scores
 * individual team members rather than the operation.
 */

import {
  addDaysToKey,
  sydneyDateKey,
  sydneyDayEndInclusive,
  sydneyDayStart,
  weekMondayKey,
} from "@/lib/time/sydney-range";

export type LaundryStatsTask = {
  id: string;
  status: string;
  pickupDate: Date;
  dropoffDate: Date;
  pickedUpAt: Date | null;
  droppedAt: Date | null;
  flagReason: string | null;
  dropoffCostAud: number | null;
  property: { id: string; name: string; suburb: string | null } | null;
};

export type LaundryWeekRow = {
  /** Sydney Monday, yyyy-MM-dd. */
  key: string;
  scheduled: number;
  pickedUp: number;
  dropped: number;
  flagged: number;
  skipped: number;
  costAud: number;
};

export type LaundryLeaderboardRow = {
  propertyId: string;
  label: string;
  count: number;
  dropped: number;
};

export type LaundryOpsStats = {
  windowStartKey: string;
  weeks: LaundryWeekRow[];
  droppedCount: number;
  onTimeCount: number;
  /** null when nothing has completed a full pickup→drop cycle yet. */
  avgTurnaroundHours: number | null;
  outstandingCount: number;
  overdue: Array<{ task: LaundryStatsTask; pickedUpKey: string; daysOut: number }>;
  monthDroppedCount: number;
  monthCostAud: number;
  leaderboard: LaundryLeaderboardRow[];
};

/** Whole Sydney calendar days between two yyyy-MM-dd keys. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** First Sydney Monday of a trend window ending in the week containing todayKey. */
export function laundryWindowStartKey(todayKey: string, trendWeeks: number): string {
  return addDaysToKey(weekMondayKey(todayKey), -7 * (trendWeeks - 1));
}

export function buildLaundryOpsStats(
  tasks: LaundryStatsTask[],
  options: { todayKey: string; maxOutdoorDays: number; trendWeeks: number; leaderboardSize: number }
): LaundryOpsStats {
  const { todayKey, maxOutdoorDays, trendWeeks, leaderboardSize } = options;
  const windowStartKey = laundryWindowStartKey(todayKey, trendWeeks);

  // ── Weekly buckets ──────────────────────────────────────────────────────
  const weeks: LaundryWeekRow[] = [];
  for (let i = 0; i < trendWeeks; i++) {
    const key = addDaysToKey(windowStartKey, i * 7);
    const start = sydneyDayStart(key);
    const end = sydneyDayStart(addDaysToKey(key, 7));
    const inWeek = (value: Date | null | undefined) => {
      if (!value) return false;
      const t = new Date(value);
      return t >= start && t < end;
    };
    // Flagged and skipped belong to the week the pickup was SCHEDULED for, not
    // the week someone noticed — otherwise a Friday miss chased into Monday
    // makes the good week look bad and the bad week look clean.
    const scheduled = tasks.filter((t) => inWeek(t.pickupDate));
    weeks.push({
      key,
      scheduled: scheduled.length,
      pickedUp: tasks.filter((t) => inWeek(t.pickedUpAt)).length,
      dropped: tasks.filter((t) => inWeek(t.droppedAt)).length,
      flagged: scheduled.filter((t) => t.status === "FLAGGED" || t.flagReason).length,
      skipped: scheduled.filter((t) => t.status === "SKIPPED_PICKUP").length,
      costAud: tasks
        .filter((t) => inWeek(t.droppedAt))
        .reduce((sum, t) => sum + (t.dropoffCostAud ?? 0), 0),
    });
  }

  // ── Completion quality ──────────────────────────────────────────────────
  const droppedTasks = tasks.filter((t) => t.droppedAt);
  const onTime = droppedTasks.filter(
    (t) =>
      new Date(t.droppedAt as Date) <=
      sydneyDayEndInclusive(sydneyDateKey(new Date(t.dropoffDate)))
  );

  const turnaroundHours = droppedTasks
    .filter((t) => t.pickedUpAt)
    .map(
      (t) =>
        (new Date(t.droppedAt as Date).getTime() - new Date(t.pickedUpAt as Date).getTime()) /
        3_600_000
    )
    // A negative span means the two timestamps were recorded out of order;
    // averaging it in would flatter the figure rather than expose the bad row.
    .filter((h) => h >= 0);
  const avgTurnaroundHours =
    turnaroundHours.length > 0
      ? turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length
      : null;

  // ── Still out ───────────────────────────────────────────────────────────
  const outstanding = tasks.filter((t) => t.status === "PICKED_UP");
  const overdue = outstanding
    .filter((t) => t.pickedUpAt)
    .map((task) => {
      const pickedUpKey = sydneyDateKey(new Date(task.pickedUpAt as Date));
      return { task, pickedUpKey, daysOut: daysBetweenKeys(pickedUpKey, todayKey) };
    })
    .filter((row) => row.daysOut > maxOutdoorDays)
    .sort((a, b) => b.daysOut - a.daysOut);

  // ── This Sydney month ───────────────────────────────────────────────────
  const monthPrefix = todayKey.slice(0, 7);
  const monthDropped = droppedTasks.filter((t) =>
    sydneyDateKey(new Date(t.droppedAt as Date)).startsWith(monthPrefix)
  );

  // ── Per-property volume ─────────────────────────────────────────────────
  const byProperty = new Map<string, LaundryLeaderboardRow>();
  for (const t of tasks) {
    if (!t.property) continue;
    const entry = byProperty.get(t.property.id) ?? {
      propertyId: t.property.id,
      label: t.property.suburb ? `${t.property.name} · ${t.property.suburb}` : t.property.name,
      count: 0,
      dropped: 0,
    };
    entry.count += 1;
    if (t.droppedAt) entry.dropped += 1;
    byProperty.set(t.property.id, entry);
  }

  return {
    windowStartKey,
    weeks,
    droppedCount: droppedTasks.length,
    onTimeCount: onTime.length,
    avgTurnaroundHours,
    outstandingCount: outstanding.length,
    overdue,
    monthDroppedCount: monthDropped.length,
    monthCostAud: monthDropped.reduce((sum, t) => sum + (t.dropoffCostAud ?? 0), 0),
    leaderboard: Array.from(byProperty.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, leaderboardSize),
  };
}
