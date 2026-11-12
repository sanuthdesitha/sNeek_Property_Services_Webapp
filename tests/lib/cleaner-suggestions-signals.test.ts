// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rankCleanerSuggestions, type SuggestionCandidate, type SuggestionJob } from "@/lib/jobs/cleaner-suggestions";
import { MIN_QA_REVIEWS, qaReason, travelForCandidate } from "@/lib/jobs/cleaner-suggestions-signals";

const m = vi.hoisted(() => ({ loadCleanFacts: vi.fn() }));
vi.mock("@/lib/quality/facts", () => ({ loadCleanFacts: m.loadCleanFacts }));
import { loadSuggestionQaScores } from "@/lib/jobs/cleaner-suggestions-qa";

const BONDI = { lat: -33.8915, lng: 151.2767 };
const MANLY = { lat: -33.7969, lng: 151.2858 };
const COOGEE = { lat: -33.9205, lng: 151.2551 };

const job: SuggestionJob = { id: "job", dayKey: "2026-11-12", startTime: "13:00", endTime: "15:00", dueTime: null, estimatedHours: null, location: BONDI };
const candidate = (overrides: Partial<SuggestionCandidate>): SuggestionCandidate => ({
  id: "x", name: "X", availability: null, otherJobsThatDay: [], priorCleansHere: 0, home: null, qa: null, ...overrides,
});
const morningAt = (location: { lat: number; lng: number } | null, name = "Manly Loft") => ({
  jobId: "o", propertyName: name, startTime: "08:00", endTime: "10:00", dueTime: null, estimatedHours: null, location,
});

describe("travel distance basis", () => {
  it("uses the previous job that day first and says so", () => {
    const travel = travelForCandidate({ destination: BONDI, startTime: "13:00", otherJobsThatDay: [morningAt(MANLY)], home: COOGEE });
    expect(travel).toMatchObject({ basis: "previous_job", fromLabel: "Manly Loft (previous job)" });
    expect(travel!.km).toBeGreaterThan(9);
    expect(travel!.km).toBeLessThan(12);
  });

  it("falls back to home only when no earlier job has a stored location", () => {
    const travel = travelForCandidate({ destination: BONDI, startTime: "13:00", otherJobsThatDay: [morningAt(null)], home: COOGEE });
    expect(travel).toMatchObject({ basis: "home", fromLabel: "home" });
    // A LATER job that day is not where the cleaner comes from.
    const later = { ...morningAt(MANLY), startTime: "16:00" };
    expect(travelForCandidate({ destination: BONDI, startTime: "13:00", otherJobsThatDay: [later], home: null })).toBeNull();
  });

  it("shows nothing without real coordinates at both ends (never a guess)", () => {
    expect(travelForCandidate({ destination: null, startTime: "13:00", otherJobsThatDay: [morningAt(MANLY)], home: COOGEE })).toBeNull();
    expect(travelForCandidate({ destination: BONDI, startTime: "13:00", otherJobsThatDay: [], home: null })).toBeNull();
    expect(travelForCandidate({ destination: { lat: 0, lng: 0 }, startTime: "13:00", otherJobsThatDay: [], home: COOGEE })).toBeNull();
  });

  it("states the basis and straight-line in the reasons, and breaks ties by the shorter known distance", () => {
    const result = rankCleanerSuggestions(job, [
      candidate({ id: "far", name: "A Far", otherJobsThatDay: [morningAt(MANLY)] }),
      candidate({ id: "near", name: "B Near", home: COOGEE, otherJobsThatDay: [morningAt(null, "Somewhere")] }),
      candidate({ id: "unknown", name: "C Unknown", otherJobsThatDay: [morningAt(null)] }),
    ]);
    expect(result.map((row) => row.cleanerId)).toEqual(["near", "far", "unknown"]);
    expect(result[0].reasons.at(-1)).toMatch(/^\d+(\.\d)? km straight-line from home$/);
    expect(result[1].reasons.join(" · ")).toContain("km straight-line from Manly Loft (previous job)");
    expect(result[2].reasons.join(" ")).not.toMatch(/km/);
    expect(result[2].travel).toBeNull();
  });

  it("leaves the calendar's move-check verdicts unchanged when travel and QA are not loaded", () => {
    const [row] = rankCleanerSuggestions({ ...job, location: undefined }, [{ id: "x", name: "X", availability: null, otherJobsThatDay: [], priorCleansHere: 0 }]);
    expect(row.reasons).toEqual(["Availability not set", "Has not cleaned here before", "No other jobs that day"]);
    expect(row).not.toHaveProperty("travel");
  });
});

describe("QA score", () => {
  it(`shows "–" below ${MIN_QA_REVIEWS} reviewed cleans and the number otherwise`, () => {
    expect(qaReason({ score: 97, reviewed: 2, periodDays: 30 })).toBe("QA – (2 reviewed cleans in 30 days; needs 3)");
    expect(qaReason({ score: null, reviewed: 0, periodDays: 30 })).toMatch(/^QA –/);
    expect(qaReason({ score: 91.6, reviewed: 8, periodDays: 30 })).toBe("QA 92 (8 reviewed, 30 days)");
  });

  it("ranks a higher shown score first only after the other rules tie", () => {
    const result = rankCleanerSuggestions(job, [
      candidate({ id: "low", name: "A", qa: { score: 70, reviewed: 9, periodDays: 30 } }),
      candidate({ id: "high", name: "B", qa: { score: 95, reviewed: 9, periodDays: 30 } }),
      candidate({ id: "thin", name: "C", qa: { score: 100, reviewed: 1, periodDays: 30 } }),
      candidate({ id: "local", name: "D", priorCleansHere: 4, qa: { score: 60, reviewed: 9, periodDays: 30 } }),
    ]);
    expect(result.map((row) => row.cleanerId)).toEqual(["local", "high", "low", "thin"]);
  });
});

describe("loadSuggestionQaScores", () => {
  beforeEach(() => m.loadCleanFacts.mockReset());

  it("reads the Quality hub's clean facts ONCE for every candidate and returns its figures", async () => {
    const now = new Date("2026-11-11T01:00:00.000Z");
    const review = (score: number) => ({ score, rating: null, managementReview: false, createdAt: now });
    m.loadCleanFacts.mockResolvedValue([
      { jobId: "1", scheduledDate: new Date("2026-11-05T00:00:00.000Z"), propertyId: "p", cleanerIds: ["jane"], review: review(90) },
      { jobId: "2", scheduledDate: new Date("2026-11-06T00:00:00.000Z"), propertyId: "p", cleanerIds: ["jane", "sam"], review: review(100) },
      { jobId: "3", scheduledDate: new Date("2026-11-07T00:00:00.000Z"), propertyId: "p", cleanerIds: ["sam"], review: null },
    ]);
    const scores = await loadSuggestionQaScores(["jane", "sam", "nia"], now);
    expect(m.loadCleanFacts).toHaveBeenCalledTimes(1);
    expect(m.loadCleanFacts.mock.calls[0][0]).toMatchObject({ key: "30d", days: 30 });
    expect(scores.get("jane")).toEqual({ score: 95, reviewed: 2, periodDays: 30 });
    expect(scores.get("sam")).toEqual({ score: 100, reviewed: 1, periodDays: 30 });
    expect(scores.get("nia")).toEqual({ score: null, reviewed: 0, periodDays: 30 });
  });
});
