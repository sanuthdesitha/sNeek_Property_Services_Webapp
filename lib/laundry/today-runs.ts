import "server-only";
import type { Prisma, Role } from "@prisma/client";
import { fetchLaundryWeekTasks, type LaundryWeekTask } from "./week-feed";
import { classifyRuns, runTasks, todayRunsRange, type RunRange } from "./run-classification";

/**
 * Today's runs for the laundry portal's Today page (owner decision
 * 2026-11-13: "only show what is scheduled today, as in the Runs page"). The
 * SAME feed query as the Runs board (`fetchLaundryWeekTasks` for today's
 * window, team-scoped) and the SAME rule (`classifyRuns`), so Today never
 * shows a failed, flagged or overdue run from another day. Those stay on
 * Runs (other ranges), Tracking, Queue and History.
 */
export type TodayRuns = {
  range: RunRange;
  pickups: LaundryWeekTask[];
  dropoffs: LaundryWeekTask[];
  /** Each run once (a key-lost set in both loops counts once). */
  tasks: LaundryWeekTask[];
  taskIds: Set<string>;
};

export async function loadTodayRuns(
  viewer: { id: string; role: Role | string },
  scope: Prisma.LaundryTaskWhereInput,
  now: Date = new Date(),
): Promise<TodayRuns> {
  const range = todayRunsRange(now);
  const feed = await fetchLaundryWeekTasks(range.start, range.endExclusive, { role: viewer.role as Role, userId: viewer.id }, scope);
  const runs = classifyRuns(feed, range);
  const tasks = runTasks(runs);
  return { range, ...runs, tasks, taskIds: new Set(tasks.map((task) => task.id)) };
}
