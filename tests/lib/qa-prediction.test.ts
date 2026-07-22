import { describe, it, expect } from "vitest";
import {
  predictDurationHours,
  predictFinishAt,
  isRunningOver,
  suggestVisitOrder,
  MIN_CONFIDENT_SAMPLES,
} from "@/lib/qa/prediction";

const at = (iso: string) => new Date(iso);

describe("predictDurationHours — blending most-specific-first", () => {
  it("uses the cleaner×property mean once there are enough samples", () => {
    const p = predictDurationHours({
      pair: { avgActualHours: 3.25, p90ActualHours: 4, sampleCount: MIN_CONFIDENT_SAMPLES },
      cleanerPaceRatio: 1.5,
      propertyBaselineHours: 2,
    });
    expect(p.hours).toBe(3.25);
    expect(p.source).toBe("CLEANER_PROPERTY");
    expect(p.conservativeHours).toBe(4); // p90 for arrival planning
  });

  it("ignores a thin sample and falls back to the cleaner's pace on the baseline", () => {
    const p = predictDurationHours({
      pair: { avgActualHours: 9, sampleCount: 1 },
      cleanerPaceRatio: 1.2,
      propertyBaselineHours: 2.5,
    });
    expect(p.source).toBe("CLEANER_PACE");
    expect(p.hours).toBeCloseTo(3, 5);
  });

  it("cold start: property baseline only", () => {
    const p = predictDurationHours({ propertyBaselineHours: 2.75 });
    expect(p.source).toBe("PROPERTY_BASELINE");
    expect(p.hours).toBe(2.75);
    expect(p.confidence).toBe("low");
  });

  it("returns null when nothing is known (never invents a number)", () => {
    const p = predictDurationHours({});
    expect(p.hours).toBeNull();
    expect(p.source).toBe("NONE");
  });

  it("clamps corrupt aggregates instead of emitting absurd ETAs", () => {
    expect(predictDurationHours({ pair: { avgActualHours: 999, sampleCount: 10 } }).hours).toBe(24);
    expect(predictDurationHours({ pair: { avgActualHours: -5, sampleCount: 10 } }).source).not.toBe("CLEANER_PROPERTY");
  });

  it("confidence rises with sample count", () => {
    const few = predictDurationHours({ pair: { avgActualHours: 3, sampleCount: MIN_CONFIDENT_SAMPLES } });
    const many = predictDurationHours({ pair: { avgActualHours: 3, sampleCount: MIN_CONFIDENT_SAMPLES * 2 } });
    expect(few.confidence).toBe("medium");
    expect(many.confidence).toBe("high");
  });
});

describe("finish prediction", () => {
  const pred = predictDurationHours({ pair: { avgActualHours: 2, sampleCount: 5 } });

  it("projects a finish instant from clock-in", () => {
    expect(predictFinishAt(at("2026-07-17T09:00:00Z"), pred)?.toISOString()).toBe("2026-07-17T11:00:00.000Z");
  });

  it("flags a clean that has run past its prediction", () => {
    expect(isRunningOver(at("2026-07-17T09:00:00Z"), pred, at("2026-07-17T11:30:00Z"))).toBe(true);
    expect(isRunningOver(at("2026-07-17T09:00:00Z"), pred, at("2026-07-17T10:30:00Z"))).toBe(false);
  });

  it("is null-safe with no clock-in or no prediction", () => {
    expect(predictFinishAt(null, pred)).toBeNull();
    expect(predictFinishAt(at("2026-07-17T09:00:00Z"), predictDurationHours({}))).toBeNull();
  });
});

describe("suggestVisitOrder", () => {
  it("orders by earliest feasible start, not input order", () => {
    const start = at("2026-07-17T09:00:00Z");
    const out = suggestVisitOrder(
      [
        { assignmentId: "late", readyAt: at("2026-07-17T12:00:00Z"), inspectionMinutes: 30 },
        { assignmentId: "early", readyAt: at("2026-07-17T09:15:00Z"), inspectionMinutes: 30 },
      ],
      start,
    );
    expect(out.map((s) => s.assignmentId)).toEqual(["early", "late"]);
  });

  it("marks a stop where the inspector would arrive before the clean is ready", () => {
    const out = suggestVisitOrder(
      [{ assignmentId: "a", readyAt: at("2026-07-17T11:00:00Z"), inspectionMinutes: 30 }],
      at("2026-07-17T09:00:00Z"),
    );
    expect(out[0].waits).toBe(true);
  });

  it("flags a deadline breach (guests arrive before the inspection could finish)", () => {
    const out = suggestVisitOrder(
      [
        {
          assignmentId: "tight",
          readyAt: at("2026-07-17T14:30:00Z"),
          inspectionMinutes: 45,
          deadlineAt: at("2026-07-17T15:00:00Z"),
        },
      ],
      at("2026-07-17T09:00:00Z"),
    );
    expect(out[0].breachesDeadline).toBe(true);
  });

  it("accounts for travel time between stops and returns every stop once", () => {
    const out = suggestVisitOrder(
      [
        { assignmentId: "a", readyAt: at("2026-07-17T09:00:00Z"), inspectionMinutes: 30 },
        { assignmentId: "b", readyAt: at("2026-07-17T09:00:00Z"), inspectionMinutes: 30, travelMinutesFromPrev: 20 },
        { assignmentId: "c", readyAt: at("2026-07-17T09:00:00Z"), inspectionMinutes: 30, travelMinutesFromPrev: 5 },
      ],
      at("2026-07-17T09:00:00Z"),
    );
    expect(out).toHaveLength(3);
    expect(new Set(out.map((s) => s.assignmentId)).size).toBe(3);
    // The 5-minute hop is preferred over the 20-minute one at equal readiness.
    expect(out[1].assignmentId).toBe("c");
  });

  it("handles an empty list", () => {
    expect(suggestVisitOrder([])).toEqual([]);
  });
});
