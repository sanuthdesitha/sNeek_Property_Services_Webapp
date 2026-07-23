import { describe, expect, it } from "vitest";
import {
  checklistProgress,
  cleanerPaceRatio,
  computeTiming,
  deriveReadiness,
  elapsedMinutes,
  predictionBasis,
} from "@/lib/qa/progress";

const NOW = new Date("2026-07-23T04:00:00.000Z");

describe("deriveReadiness", () => {
  it("treats the pre-submission working set as CLEANING", () => {
    for (const status of [
      "UNASSIGNED",
      "OFFERED",
      "ASSIGNED",
      "EN_ROUTE",
      "IN_PROGRESS",
      "PAUSED",
      "WAITING_CONTINUATION_APPROVAL",
    ]) {
      expect(deriveReadiness({ status, hasSubmission: false })).toBe("CLEANING");
    }
  });

  it("treats submitted / reviewed / finished jobs as READY", () => {
    for (const status of ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]) {
      expect(deriveReadiness({ status, hasSubmission: false })).toBe("READY");
    }
  });

  it("a filed submission wins over a lagging job status", () => {
    // The SUBMITTED transition and the FormSubmission write are not atomic —
    // the form is the real signal that there is something to grade.
    expect(deriveReadiness({ status: "IN_PROGRESS", hasSubmission: true })).toBe("READY");
  });

  it("labels an unfinished rework job separately", () => {
    expect(deriveReadiness({ status: "IN_PROGRESS", hasSubmission: false, isRework: true })).toBe("REWORK_PENDING");
    // …but a submitted rework is just READY.
    expect(deriveReadiness({ status: "SUBMITTED", hasSubmission: false, isRework: true })).toBe("READY");
  });

  it("is null-safe and case-insensitive", () => {
    expect(deriveReadiness({})).toBe("CLEANING");
    expect(deriveReadiness({ status: null, hasSubmission: null, isRework: null })).toBe("CLEANING");
    expect(deriveReadiness({ status: "submitted" })).toBe("READY");
  });
});

describe("checklistProgress", () => {
  it("computes a rounded percent", () => {
    expect(checklistProgress(3, 8)).toEqual({ answered: 3, total: 8, percent: 38 });
  });

  it("returns null when the total is unknown — never a fake 0%", () => {
    expect(checklistProgress(0, 0)).toBeNull();
    expect(checklistProgress(null, null)).toBeNull();
    expect(checklistProgress(4, undefined)).toBeNull();
  });

  it("clamps a nonsense answered count into range", () => {
    expect(checklistProgress(99, 5)).toEqual({ answered: 5, total: 5, percent: 100 });
    expect(checklistProgress(-3, 5)).toEqual({ answered: 0, total: 5, percent: 0 });
  });
});

describe("elapsedMinutes", () => {
  it("measures to now when the log is still open", () => {
    expect(elapsedMinutes("2026-07-23T03:00:00.000Z", NOW)).toBe(60);
  });

  it("measures to the stop stamp when the log is closed", () => {
    expect(elapsedMinutes("2026-07-23T03:00:00.000Z", NOW, "2026-07-23T03:45:00.000Z")).toBe(45);
  });

  it("returns null with no start, and never goes negative", () => {
    expect(elapsedMinutes(null, NOW)).toBeNull();
    expect(elapsedMinutes("not-a-date", NOW)).toBeNull();
    expect(elapsedMinutes("2026-07-23T05:00:00.000Z", NOW)).toBe(0);
  });
});

describe("computeTiming", () => {
  it("projects a finish and the minutes left", () => {
    const timing = computeTiming({
      startedAt: "2026-07-23T03:00:00.000Z",
      prediction: { hours: 3 },
      now: NOW,
    });
    expect(timing.elapsedMinutes).toBe(60);
    expect(timing.estFinishAt?.toISOString()).toBe("2026-07-23T06:00:00.000Z");
    expect(timing.minutesRemaining).toBe(120);
    expect(timing.runningOver).toBe(false);
  });

  it("flags a clean that has run past the prediction and floors the remainder", () => {
    const timing = computeTiming({
      startedAt: "2026-07-23T02:00:00.000Z",
      prediction: { hours: 1 },
      now: NOW,
    });
    expect(timing.runningOver).toBe(true);
    expect(timing.minutesRemaining).toBe(0);
  });

  it("still reports elapsed time when there is no prediction", () => {
    const timing = computeTiming({ startedAt: "2026-07-23T03:30:00.000Z", prediction: null, now: NOW });
    expect(timing.elapsedMinutes).toBe(30);
    expect(timing.estFinishAt).toBeNull();
    expect(timing.minutesRemaining).toBeNull();
    expect(timing.runningOver).toBe(false);
  });

  it("knows nothing gracefully when nothing is known", () => {
    expect(computeTiming({ now: NOW })).toEqual({
      elapsedMinutes: null,
      estFinishAt: null,
      minutesRemaining: null,
      runningOver: false,
    });
    // A zero/garbage prediction must not become an instant finish.
    expect(computeTiming({ startedAt: "2026-07-23T03:00:00.000Z", prediction: { hours: 0 }, now: NOW }).estFinishAt).toBeNull();
  });
});

describe("cleanerPaceRatio", () => {
  it("ratios total actual against total estimated", () => {
    expect(
      cleanerPaceRatio([
        { actualHours: 3, estimatedHours: 2 },
        { actualHours: 3, estimatedHours: 2 },
        { actualHours: 3, estimatedHours: 2 },
      ]),
    ).toBeCloseTo(1.5);
  });

  it("returns null below the sample floor or with unusable rows", () => {
    expect(cleanerPaceRatio([{ actualHours: 3, estimatedHours: 2 }])).toBeNull();
    expect(cleanerPaceRatio([])).toBeNull();
    expect(
      cleanerPaceRatio([
        { actualHours: null, estimatedHours: 2 },
        { actualHours: 3, estimatedHours: 0 },
        { actualHours: 3, estimatedHours: null },
      ]),
    ).toBeNull();
  });

  it("clamps a corrupt aggregate so an ETA can't triple", () => {
    expect(
      cleanerPaceRatio([
        { actualHours: 40, estimatedHours: 1 },
        { actualHours: 40, estimatedHours: 1 },
        { actualHours: 40, estimatedHours: 1 },
      ]),
    ).toBe(2);
  });
});

describe("predictionBasis", () => {
  it("explains where an estimate came from", () => {
    expect(predictionBasis({ source: "CLEANER_PROPERTY" }, 6)).toBe("based on 6 previous cleans here");
    expect(predictionBasis({ source: "CLEANER_PROPERTY" }, 1)).toBe("based on 1 previous clean here");
    expect(predictionBasis({ source: "PROPERTY_BASELINE" })).toBe("estimated from the property's standard hours");
    expect(predictionBasis({ source: "CLEANER_PACE" })).toBe("estimated from this cleaner's usual pace");
  });

  it("says nothing when there is no estimate", () => {
    expect(predictionBasis(null)).toBeNull();
    expect(predictionBasis({ source: "NONE" })).toBeNull();
  });
});
