import { describe, it, expect } from "vitest";
import { summarizeSamples } from "@/lib/qa/cleaner-property-stats";

describe("summarizeSamples — the duration model's aggregation", () => {
  it("averages a clean sample set and reports the count", () => {
    const out = summarizeSamples([2, 2.5, 3])!;
    expect(out.sampleCount).toBe(3);
    expect(out.avgActualHours).toBeCloseTo(2.5, 3);
  });

  it("drops a forgot-to-clock-out outlier instead of poisoning the mean", () => {
    // Five ~3h cleans and one 20h ghost. The mean must stay near 3.
    const out = summarizeSamples([3, 3.1, 2.9, 3.2, 3, 20])!;
    expect(out.avgActualHours).toBeLessThan(4);
    expect(out.sampleCount).toBe(5);
  });

  it("computes a p90 at or above the mean for conservative arrival planning", () => {
    const out = summarizeSamples([2, 2.2, 2.4, 2.6, 3.5])!;
    expect(out.p90ActualHours).toBeGreaterThanOrEqual(out.avgActualHours);
  });

  it("rejects impossible values (negative, zero, >24h)", () => {
    expect(summarizeSamples([-3, 0, 99])).toBeNull();
    const out = summarizeSamples([-3, 0, 99, 2.5])!;
    expect(out.sampleCount).toBe(1);
    expect(out.avgActualHours).toBe(2.5);
  });

  it("returns null for an empty sample set (no row is better than a fake one)", () => {
    expect(summarizeSamples([])).toBeNull();
  });

  it("keeps a single sample as-is (no variance to filter on)", () => {
    const out = summarizeSamples([4])!;
    expect(out.avgActualHours).toBe(4);
    expect(out.p90ActualHours).toBe(4);
    expect(out.sampleCount).toBe(1);
  });
});
