import "server-only";
/**
 * The Laundry Statistics figures (moved from the standalone stats page, same
 * query and the same tested rules in lib/laundry/ops-stats.ts), for the
 * Statistics tab of the Laundry page.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { buildLaundryOpsStats, laundryWindowStartKey, type LaundryOpsStats, type LaundryStatsTask } from "@/lib/laundry/ops-stats";
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

export const LAUNDRY_STATS_TREND_WEEKS = 8;
export const LAUNDRY_STATS_LEADERBOARD_SIZE = 10;

export type LaundryStatsPayload = {
  stats: LaundryOpsStats;
  maxOutdoorDays: number;
  trendWeeks: number;
  leaderboardSize: number;
  todayKey: string;
};

export async function loadLaundryStats(): Promise<LaundryStatsPayload> {
  const settings = await getAppSettings();
  const maxOutdoorDays = settings.laundryOperations?.maxOutdoorDays ?? 3;
  const todayKey = sydneyTodayKey();
  const windowStart = sydneyDayStart(laundryWindowStartKey(todayKey, LAUNDRY_STATS_TREND_WEEKS));
  // The PICKED_UP arm is deliberately unbounded: a bag that went out three
  // months ago and never came back is exactly what "at laundry now" must show.
  const tasks = (await db.laundryTask.findMany({
    where: { OR: [{ pickupDate: { gte: windowStart } }, { droppedAt: { gte: windowStart } }, { status: "PICKED_UP" }] },
    select: {
      id: true,
      status: true,
      pickupDate: true,
      dropoffDate: true,
      pickedUpAt: true,
      droppedAt: true,
      flagReason: true,
      dropoffCostAud: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
  })) as LaundryStatsTask[];
  const stats = buildLaundryOpsStats(tasks, {
    todayKey,
    maxOutdoorDays,
    trendWeeks: LAUNDRY_STATS_TREND_WEEKS,
    leaderboardSize: LAUNDRY_STATS_LEADERBOARD_SIZE,
  });
  return { stats, maxOutdoorDays, trendWeeks: LAUNDRY_STATS_TREND_WEEKS, leaderboardSize: LAUNDRY_STATS_LEADERBOARD_SIZE, todayKey };
}
