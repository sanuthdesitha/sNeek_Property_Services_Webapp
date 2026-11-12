/**
 * Jobs date shortcuts as Sydney calendar-day ranges (yyyy-MM-dd keys, both
 * ends inclusive). Shared by the Jobs page, its view tabs and the server
 * count query so "Today" means the same Sydney day everywhere.
 */
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";

export type JobsDateScope = "all" | "today" | "tomorrow" | "week" | "upcoming" | "past";

export const JOBS_DATE_SCOPES: ReadonlyArray<{ id: JobsDateScope; label: string }> = [
  { id: "all", label: "Any date" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "Next 7 days" },
  { id: "upcoming", label: "From tomorrow" },
  { id: "past", label: "Before today" },
];

export type DateKeyRange = { dateFrom?: string; dateTo?: string };

export function jobsDateScopeRange(scope: string, now: Date = new Date()): DateKeyRange {
  const today = sydneyTodayKey(now);
  switch (scope) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "tomorrow":
      return { dateFrom: addDaysToKey(today, 1), dateTo: addDaysToKey(today, 1) };
    case "week":
      return { dateFrom: today, dateTo: addDaysToKey(today, 6) };
    case "upcoming":
      return { dateFrom: addDaysToKey(today, 1) };
    case "past":
      return { dateTo: addDaysToKey(today, -1) };
    default:
      return {};
  }
}
