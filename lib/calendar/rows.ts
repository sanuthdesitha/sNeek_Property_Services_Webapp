/**
 * Calendar rows (cleaners or properties) with their hour totals. Pure, so the
 * hours basis is tested without a database.
 *
 * Which cleaners get a row: every active cleaner (so work can be dropped on
 * someone who has none yet) plus any cleaner, active or not, with work in the
 * range. Inactive cleaners with no work in range are omitted. Properties: only
 * those with a job in the (filtered) range.
 */
import type { CalendarJob, CalendarRow } from "./types";

export type RowSource = { id: string; label: string; active: boolean; unavailable: Record<string, string> };

function jobsForRow(jobs: CalendarJob[], kind: CalendarRow["kind"], id: string): CalendarJob[] {
  return kind === "cleaner"
    ? jobs.filter((job) => job.cleaners.some((cleaner) => cleaner.id === id))
    : jobs.filter((job) => job.propertyId === id);
}

/**
 * A job counts in full for each cleaner on it (each person works the job);
 * skipped cleans count for nobody.
 */
export function buildRows(sources: RowSource[], jobs: CalendarJob[], kind: CalendarRow["kind"]): CalendarRow[] {
  return sources
    .map((source) => {
      const rowJobs = jobsForRow(jobs, kind, source.id).filter((job) => !job.skipped);
      const hours = rowJobs.reduce((total, job) => total + (job.hours ?? 0), 0);
      return {
        id: source.id,
        label: source.label,
        kind,
        active: source.active,
        hours: Math.round(hours * 100) / 100,
        jobsWithoutHours: rowJobs.filter((job) => job.hours === null).length,
        unavailable: source.unavailable,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
