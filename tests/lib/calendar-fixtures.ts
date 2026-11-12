import type { CalendarJob, CalendarResponse } from "@/lib/calendar/types";

/** A calendar job for tests; override only what a test is about. */
export function calendarJob(overrides: Partial<CalendarJob> = {}): CalendarJob {
  return {
    id: "j1", jobNumber: "J-1", propertyId: "p1", propertyName: "Bondi Studio", propertyMissingName: false, suburb: "Bondi",
    clientId: "c1", clientName: "Harbour", jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", day: "2026-11-11",
    startTime: "10:00", endTime: null, dueTime: "14:00", estimatedHours: null, hours: 4,
    cleaners: [{ id: "u1", name: "Jane C.", isPrimary: true }], skipped: false, late: false, guestArrival: null,
    moveBlock: null, updatedAt: "2026-11-01T00:00:00.000Z", qa: null, ...overrides,
  };
}

/** A week response (9–15 Nov 2026, today 11 Nov) around the given jobs. */
export function calendarResponse(jobs: CalendarJob[], overrides: Partial<CalendarResponse> = {}): CalendarResponse {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  return {
    range: { start: days[0], end: days[6], days }, today: "2026-11-11", generatedAt: "2026-11-11T00:00:00.000Z", rowsMode: "cleaners",
    cleanerRows: [
      { id: "u1", label: "Jane C.", kind: "cleaner", active: true, hours: 31, jobsWithoutHours: 0, unavailable: { "2026-11-15": "Not available on Sundays" } },
      { id: "u2", label: "Aiko T.", kind: "cleaner", active: true, hours: 0, jobsWithoutHours: 0, unavailable: {} },
    ],
    propertyRows: [], jobs, laundry: null,
    summary: { jobs: jobs.length, withoutCleaner: jobs.filter((job) => job.cleaners.length === 0).length, skipped: 0, statusCounts: {}, unassignedTotal: 0 },
    hoursBasis: "Scheduled hours basis.", truncated: false, ...overrides,
  };
}
