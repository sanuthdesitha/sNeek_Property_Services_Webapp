import type { CalendarResponse } from "./types";

/**
 * A background refresh must never redraw a chip whose move is being checked or
 * saved: the chip stays exactly as it was until the save answers. Every other
 * job, row and count comes from the fresh response. A pending job the fresh
 * response no longer contains (moved out of range by someone else) keeps its
 * old version until the save settles, then the next read decides.
 */
export function mergePreservingPending(previous: CalendarResponse | null, next: CalendarResponse, pendingIds: ReadonlySet<string>): CalendarResponse {
  if (!previous || pendingIds.size === 0) return next;
  if (previous.range.start !== next.range.start || previous.range.end !== next.range.end) return next;
  const previousById = new Map(previous.jobs.map((job) => [job.id, job]));
  const jobs = next.jobs.map((job) => (pendingIds.has(job.id) ? previousById.get(job.id) ?? job : job));
  const present = new Set(jobs.map((job) => job.id));
  for (const id of Array.from(pendingIds)) {
    const kept = previousById.get(id);
    if (kept && !present.has(id)) jobs.push(kept);
  }
  return { ...next, jobs };
}
