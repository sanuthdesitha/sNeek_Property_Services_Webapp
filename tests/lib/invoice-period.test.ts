import { describe, it, expect } from "vitest";
import { sydneyDayBoundary } from "@/lib/billing/period";

/**
 * This guard briefly shipped with its regex backslashes stripped by a codemod
 * (/^d{4}-d{2}-d{2}$/), which rejected every real date, nulled every period,
 * and would have billed a client every uninvoiced job they ever had. These
 * tests exist so that exact class of mangling can never pass CI again.
 */
describe("sydneyDayBoundary", () => {
  it("accepts a plain calendar date", () => {
    expect(sydneyDayBoundary("2026-07-01", "start")).not.toBeNull();
  });

  it("accepts the ISO instants both panels actually post", () => {
    expect(sydneyDayBoundary("2026-07-01T00:00:00.000Z", "start")).not.toBeNull();
    expect(sydneyDayBoundary("2026-07-31T23:59:59.999Z", "end")).not.toBeNull();
  });

  it("start of day is midnight Sydney, not midnight UTC", () => {
    const start = sydneyDayBoundary("2026-07-01", "start")!;
    // July = AEST (UTC+10): 1 Jul 00:00 Sydney is 30 Jun 14:00 UTC.
    expect(start.toISOString()).toBe("2026-06-30T14:00:00.000Z");
  });

  it("end of day is 23:59:59.999 Sydney on the SAME day", () => {
    const end = sydneyDayBoundary("2026-07-31", "end")!;
    expect(end.toISOString()).toBe("2026-07-31T13:59:59.999Z");
  });

  it("handles daylight saving (January = AEDT, UTC+11)", () => {
    const start = sydneyDayBoundary("2026-01-15", "start")!;
    expect(start.toISOString()).toBe("2026-01-14T13:00:00.000Z");
  });

  it("absent input means no bound", () => {
    expect(sydneyDayBoundary(null, "start")).toBeNull();
    expect(sydneyDayBoundary(undefined, "end")).toBeNull();
    expect(sydneyDayBoundary("", "start")).toBeNull();
  });

  it("THROWS on present-but-unreadable input instead of billing everything", () => {
    // Degrading to null here means "no period bound at all" — the failure mode
    // is an invoice containing every uninvoiced job, so refusal is the only
    // safe answer.
    expect(() => sydneyDayBoundary("July 2026", "start")).toThrow(/Unreadable period date/);
    expect(() => sydneyDayBoundary("01/07/2026", "start")).toThrow(/Unreadable period date/);
    expect(() => sydneyDayBoundary("2026-7-1", "start")).toThrow(/Unreadable period date/);
  });
});
