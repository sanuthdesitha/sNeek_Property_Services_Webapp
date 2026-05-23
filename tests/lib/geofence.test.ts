import { describe, it, expect } from "vitest";
import { haversine } from "@/lib/gps/distance";

describe("haversine", () => {
  it("returns ~0 for identical points", () => {
    expect(haversine(-33.8688, 151.2093, -33.8688, 151.2093)).toBeCloseTo(0, 3);
  });

  it("returns ~111km for 1 degree latitude difference", () => {
    const d = haversine(-33.8688, 151.2093, -32.8688, 151.2093);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("returns ~75m within configured geofence radius", () => {
    // ~75m east at -33.8688 lat is about 0.00081 deg lng
    const d = haversine(-33.8688, 151.2093, -33.8688, 151.2093 + 0.00081);
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(80);
  });
});
