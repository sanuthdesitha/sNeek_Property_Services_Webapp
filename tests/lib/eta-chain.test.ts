import { describe, expect, it, vi } from "vitest";
import {
  estimateChainedEtaMinutes,
  naiveLegMinutes,
  roundEtaMinutes,
  type LatLng,
} from "@/lib/laundry/eta-chain";
import { NAIVE_PER_STOP_MIN, NAIVE_SPEED_KMH } from "@/lib/laundry/route-plan";

// Sydney-ish coordinates. ~0.1° of latitude ≈ 11.1 km.
const DRIVER: LatLng = { lat: -33.9, lng: 151.2 };
const STOP_A: LatLng = { lat: -33.85, lng: 151.2 };
const STOP_B: LatLng = { lat: -33.8, lng: 151.2 };
const TARGET: LatLng = { lat: -33.75, lng: 151.2 };

describe("roundEtaMinutes", () => {
  it("rounds UP to 5-minute precision", () => {
    expect(roundEtaMinutes(21)).toBe(25);
    expect(roundEtaMinutes(20)).toBe(20);
    expect(roundEtaMinutes(5.01)).toBe(10);
  });

  it("never goes below the 5-minute floor", () => {
    expect(roundEtaMinutes(0)).toBe(5);
    expect(roundEtaMinutes(0.4)).toBe(5);
  });
});

describe("estimateChainedEtaMinutes", () => {
  it("N=0: uses the precise leg estimator when it resolves", async () => {
    const legEtaFn = vi.fn().mockResolvedValue(12);
    const eta = await estimateChainedEtaMinutes({ driverPos: DRIVER, stops: [], target: TARGET, legEtaFn });
    expect(legEtaFn).toHaveBeenCalledTimes(1);
    expect(legEtaFn).toHaveBeenCalledWith(DRIVER, TARGET);
    expect(eta).toBe(15); // 12 rounded up to 5-min precision
  });

  it("N=0: falls back to the naive 35km/h haversine estimate when the estimator returns null", async () => {
    const legEtaFn = vi.fn().mockResolvedValue(null);
    const eta = await estimateChainedEtaMinutes({ driverPos: DRIVER, stops: [], target: TARGET, legEtaFn });
    expect(eta).toBe(roundEtaMinutes(naiveLegMinutes(DRIVER, TARGET)));
    // Sanity-check the fallback speed math itself: minutes = km / 35 * 60.
    const raw = naiveLegMinutes(DRIVER, TARGET);
    expect(raw).toBeGreaterThan(25); // ~16.7km at 35km/h ≈ 28.6 min
    expect(raw).toBeLessThan(35);
    expect((raw / 60) * NAIVE_SPEED_KMH).toBeCloseTo(16.68, 0); // back out the km
  });

  it("N=2: chains naive legs and adds per-stop service time, never calling the precise estimator", async () => {
    const legEtaFn = vi.fn().mockResolvedValue(1);
    const eta = await estimateChainedEtaMinutes({
      driverPos: DRIVER,
      stops: [STOP_A, STOP_B],
      target: TARGET,
      legEtaFn,
    });
    expect(legEtaFn).not.toHaveBeenCalled();
    const raw =
      naiveLegMinutes(DRIVER, STOP_A) +
      naiveLegMinutes(STOP_A, STOP_B) +
      naiveLegMinutes(STOP_B, TARGET) +
      2 * NAIVE_PER_STOP_MIN;
    expect(eta).toBe(roundEtaMinutes(raw));
    expect(eta % 5).toBe(0);
  });

  it("counts service time for coordinate-less stops via serviceStopCount", async () => {
    const withService = await estimateChainedEtaMinutes({
      driverPos: DRIVER,
      stops: [STOP_A],
      target: TARGET,
      serviceStopCount: 3,
    });
    const raw =
      naiveLegMinutes(DRIVER, STOP_A) + naiveLegMinutes(STOP_A, TARGET) + 3 * NAIVE_PER_STOP_MIN;
    expect(withService).toBe(roundEtaMinutes(raw));
  });

  it("applies the 5-minute minimum when the driver is basically at the door", async () => {
    const eta = await estimateChainedEtaMinutes({ driverPos: TARGET, stops: [], target: TARGET });
    expect(eta).toBe(5);
  });
});
