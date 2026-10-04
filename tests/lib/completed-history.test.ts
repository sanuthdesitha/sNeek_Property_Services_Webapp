import { describe, expect, it } from "vitest";
import { completedServiceDate, summarizeCompletedHistory } from "@/lib/accounts/completed-history";
const now = new Date("2026-10-03T12:00:00Z");
describe("completed service history", () => {
  it("excludes future, uncompleted and invalid records; edits never become cleans", () => {
    const rows = [
      { status: "COMPLETED", scheduledDate: "2026-09-18", completedAt: "2026-09-18T05:00:00Z", updatedAt: now },
      { status: "OFFERED", scheduledDate: "2027-01-01" },
      { status: "IN_PROGRESS", scheduledDate: "2026-10-03" },
      { status: "COMPLETED", scheduledDate: "2027-01-01", completedAt: "2027-01-01" },
      { status: "COMPLETED", scheduledDate: "invalid" },
      { status: "COMPLETED", scheduledDate: null },
      { status: "INVOICED", scheduledDate: "2026-06-01", completedAt: null },
      { status: "COMPLETED", scheduledDate: "2025-01-01" },
    ];
    expect(summarizeCompletedHistory(rows, now)).toEqual({lastJobAt:new Date("2026-09-18T05:00:00Z"),jobsLast30d:1,jobsLast90d:1,jobsLast365d:2});
    expect(completedServiceDate(rows[6], now)).toEqual(new Date("2026-06-01"));
  });
  it("uses completion time over scheduled time and includes exact window boundaries", () => {
    const dates=[0,30,90,365,366].map(days=>new Date(now.getTime()-days*86_400_000));
    expect(summarizeCompletedHistory(dates.map(completedAt=>({status:"COMPLETED",scheduledDate:"2000-01-01",completedAt})),now)).toEqual({lastJobAt:now,jobsLast30d:2,jobsLast90d:3,jobsLast365d:4});
    expect(summarizeCompletedHistory([],now).lastJobAt).toBeNull();
    expect(summarizeCompletedHistory([]).jobsLast30d).toBe(0);
    expect(completedServiceDate({status:"OFFERED",scheduledDate:null})).toBeNull();
  });
});
