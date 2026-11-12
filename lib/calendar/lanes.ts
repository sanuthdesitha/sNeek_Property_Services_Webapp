/**
 * The rows the week and day views draw, built from one range response:
 * cleaners mode = an "Unassigned" lane, then one lane per cleaner row (a job
 * with two cleaners appears in both); properties mode = one lane per property.
 * Jobs in each cell are ordered by start time (no time last).
 */
import type { DropLane } from "./drop";
import type { CalendarJob, CalendarResponse, CalendarRow } from "./types";

export type CalendarLane = {
  key: string;
  lane: DropLane;
  rowId: string | null;
  label: string;
  row: CalendarRow | null;
  jobsByDay: Map<string, CalendarJob[]>;
  jobCount: number;
};

function byStart(a: CalendarJob, b: CalendarJob): number {
  return (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99") || a.propertyName.localeCompare(b.propertyName);
}

function group(jobs: CalendarJob[]): Map<string, CalendarJob[]> {
  const map = new Map<string, CalendarJob[]>();
  for (const job of jobs) {
    const list = map.get(job.day) ?? [];
    list.push(job);
    map.set(job.day, list);
  }
  map.forEach((list) => list.sort(byStart));
  return map;
}

export function sortByStart(jobs: CalendarJob[]): CalendarJob[] {
  return [...jobs].sort(byStart);
}

export function buildLanes(data: CalendarResponse, rowsMode: "cleaners" | "properties"): CalendarLane[] {
  if (rowsMode === "properties") {
    return data.propertyRows.map((row) => {
      const jobs = data.jobs.filter((job) => job.propertyId === row.id);
      return { key: `property:${row.id}`, lane: "property", rowId: row.id, label: row.label, row, jobsByDay: group(jobs), jobCount: jobs.length };
    });
  }
  const unassigned = data.jobs.filter((job) => job.cleaners.length === 0);
  const lanes: CalendarLane[] = [
    { key: "unassigned", lane: "unassigned", rowId: null, label: "Unassigned", row: null, jobsByDay: group(unassigned), jobCount: unassigned.length },
  ];
  for (const row of data.cleanerRows) {
    const jobs = data.jobs.filter((job) => job.cleaners.some((cleaner) => cleaner.id === row.id));
    lanes.push({ key: `cleaner:${row.id}`, lane: "cleaner", rowId: row.id, label: row.label, row, jobsByDay: group(jobs), jobCount: jobs.length });
  }
  return lanes;
}

/** Jobs of one day, every job once (for lists and the month grid). */
export function jobsOnDay(data: CalendarResponse, day: string): CalendarJob[] {
  return sortByStart(data.jobs.filter((job) => job.day === day));
}
