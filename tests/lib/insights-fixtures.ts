import type { FactContext, InsightsJobRow } from "@/lib/insights/job-facts";

/** A complete clean: rate, pay rate snapshot, allocated time, finished log, start time, review. */
export function jobRow(overrides: Partial<InsightsJobRow> = {}): InsightsJobRow {
  return {
    id: "job-1",
    jobNumber: "J-1",
    // 2026-10-05 in Sydney (UTC midnight of the day before + 13h = Sydney midnight).
    scheduledDate: new Date("2026-10-04T13:00:00Z"),
    startTime: "10:00",
    jobType: "AIRBNB_TURNOVER",
    estimatedHours: 3,
    fixedPrice: null,
    isRework: false,
    reworkPayAmount: null,
    internalNotes: null,
    cleanSkipStatus: "NONE",
    propertyId: "prop-1",
    property: { name: "Glebe House", clientId: "client-1", client: { name: "Northside Lets" } },
    assignments: [
      { userId: "cleaner-1", payRate: 30, removedAt: null, user: { name: "Ana", email: null, role: "CLEANER", hourlyRate: null } },
    ],
    // 10:05 Sydney (AEDT +11) = 23:05 UTC the day before; 200 minutes logged.
    timeLogs: [{ userId: "cleaner-1", startedAt: new Date("2026-10-04T23:05:00Z"), stoppedAt: new Date("2026-10-05T02:25:00Z"), durationM: 200 }],
    payAdjustments: [],
    qaReviews: [{ score: 90, kind: "QA", rating: null, managementReview: false, createdAt: new Date("2026-10-06T00:00:00Z") }],
    reworkOfJob: null,
    ...overrides,
  };
}

export const context: FactContext = {
  rates: { propertyRates: [{ propertyId: "prop-1", jobType: "AIRBNB_TURNOVER", baseCharge: 150, defaultDescription: null }], priceBook: [] },
  cleanerJobHourlyRates: {},
};
