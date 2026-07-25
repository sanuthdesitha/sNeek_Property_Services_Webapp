import { describe, it, expect } from "vitest";
import { evaluateDeparture, isInsideGeofence } from "@/lib/gps/departure";
import { DEFAULT_GEOFENCE_RADIUS_M } from "@/lib/gps/distance";

// Property in Sydney; ~1 deg lng ≈ 92.5km at this latitude, so
// 0.00081 deg ≈ 75m and 0.002 deg ≈ 185m.
const PROP = { propertyLat: -33.8688, propertyLng: 151.2093 };

const INSIDE = { lat: -33.8688, lng: 151.2093 }; // 0m
const NEAR_OUTSIDE = { lat: -33.8688, lng: 151.2093 + 0.00087 }; // ~80m — outside 75m fence but inside hysteresis band
const FAR = { lat: -33.8688, lng: 151.2093 + 0.002 }; // ~185m — clearly outside 100m threshold

function ping(
  pos: { lat: number; lng: number },
  minutesAgo: number,
  accuracy: number | null = 10,
) {
  return {
    lat: pos.lat,
    lng: pos.lng,
    accuracy,
    timestamp: new Date(NOW.getTime() - minutesAgo * 60_000),
  };
}

const NOW = new Date("2026-07-25T10:00:00Z");

describe("isInsideGeofence", () => {
  it("is true at the property and false 185m away", () => {
    expect(isInsideGeofence(INSIDE.lat, INSIDE.lng, PROP.propertyLat, PROP.propertyLng)).toBe(true);
    expect(isInsideGeofence(FAR.lat, FAR.lng, PROP.propertyLat, PROP.propertyLng)).toBe(false);
  });

  it("respects a custom radius", () => {
    expect(isInsideGeofence(FAR.lat, FAR.lng, PROP.propertyLat, PROP.propertyLng, 500)).toBe(true);
  });
});

describe("evaluateDeparture", () => {
  it("never confirms with no pings", () => {
    const r = evaluateDeparture({ pings: [], ...PROP, now: NOW });
    expect(r.confirmedDeparted).toBe(false);
    expect(r.departedAt).toBeUndefined();
  });

  it("never confirms with fewer than 3 accurate pings", () => {
    const r = evaluateDeparture({ pings: [ping(FAR, 0), ping(FAR, 3)], ...PROP, now: NOW });
    expect(r.confirmedDeparted).toBe(false);
  });

  it("GPS drift: 2 outside + 1 inside among the latest 3 → not departed", () => {
    const r = evaluateDeparture({
      pings: [ping(FAR, 0), ping(INSIDE, 2), ping(FAR, 4), ping(INSIDE, 6)],
      ...PROP,
      now: NOW,
    });
    expect(r.confirmedDeparted).toBe(false);
  });

  it("3 outside pings spanning under 2 minutes → not departed", () => {
    const r = evaluateDeparture({
      pings: [ping(FAR, 0), ping(FAR, 0.5), ping(FAR, 1.5)],
      ...PROP,
      now: NOW,
    });
    expect(r.confirmedDeparted).toBe(false);
  });

  it("3 outside pings spanning >= 2 minutes → departed, stamped at the run start", () => {
    const r = evaluateDeparture({
      pings: [ping(FAR, 0), ping(FAR, 1.5), ping(FAR, 3), ping(INSIDE, 5)],
      ...PROP,
      now: NOW,
    });
    expect(r.confirmedDeparted).toBe(true);
    expect(r.departedAt).toEqual(new Date(NOW.getTime() - 3 * 60_000));
  });

  it("extends departedAt back through a longer continuous outside-run", () => {
    const r = evaluateDeparture({
      pings: [ping(FAR, 0), ping(FAR, 2), ping(FAR, 4), ping(FAR, 6), ping(INSIDE, 8)],
      ...PROP,
      now: NOW,
    });
    expect(r.confirmedDeparted).toBe(true);
    // The run started at the 6-minutes-ago ping, not 4.
    expect(r.departedAt).toEqual(new Date(NOW.getTime() - 6 * 60_000));
  });

  it("ignores low-accuracy pings (a 500m fix can neither confirm nor veto)", () => {
    // Latest ping is low-accuracy "inside" — ignored; the accurate outside
    // run underneath still confirms.
    const confirms = evaluateDeparture({
      pings: [ping(INSIDE, 0, 500), ping(FAR, 1), ping(FAR, 2.5), ping(FAR, 4)],
      ...PROP,
      now: NOW,
    });
    expect(confirms.confirmedDeparted).toBe(true);

    // Only 2 accurate outside pings + a low-accuracy far one → not enough.
    const vetoed = evaluateDeparture({
      pings: [ping(FAR, 0), ping(FAR, 2.5), ping(FAR, 5, 500)],
      ...PROP,
      now: NOW,
    });
    expect(vetoed.confirmedDeparted).toBe(false);
  });

  it("null accuracy counts as accurate", () => {
    const r = evaluateDeparture({
      pings: [ping(FAR, 0, null), ping(FAR, 1.5, null), ping(FAR, 3, null)],
      ...PROP,
      now: NOW,
    });
    expect(r.confirmedDeparted).toBe(true);
  });

  it("hysteresis: ~80m (outside the 75m fence but under 100m) → not departed", () => {
    const r = evaluateDeparture({
      pings: [ping(NEAR_OUTSIDE, 0), ping(NEAR_OUTSIDE, 2), ping(NEAR_OUTSIDE, 4)],
      ...PROP,
      radiusM: DEFAULT_GEOFENCE_RADIUS_M,
      now: NOW,
    });
    expect(r.confirmedDeparted).toBe(false);
  });
});
