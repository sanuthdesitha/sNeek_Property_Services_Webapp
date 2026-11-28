// @vitest-environment node
/** Pilot "Check-in location": a refused permission clocks in with a reason only when the pilot is on; never recorded as on site. */
import { describe, expect, it } from "vitest";
import { evaluateStartLocation, noFixErrorLabel, noFixSchema, startLocationSchema } from "@/lib/gps/start-location";

const property = { name: "Unit 4", latitude: -33.89, longitude: 151.27, geofenceRadiusM: null };
const denied = startLocationSchema.parse({ noFix: { reason: "Location is off", error: "PERMISSION_DENIED" } });

describe("clock-in with location turned off", () => {
  it("pilot off: refused exactly as before", () => {
    const decision = evaluateStartLocation({ location: denied, property, tagTapped: false });
    expect(decision).toMatchObject({ ok: false, body: { error: "LOCATION_REQUIRED" } });
  });

  it("pilot on: starts with the reason, no position, verdict NO_FIX (never inside)", () => {
    const decision = evaluateStartLocation({ location: denied, property, tagTapped: false, allowPermissionDenied: true });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.record.columns).toMatchObject({ startLat: null, startDistanceM: null, startVerdict: "NO_FIX", startReasonCode: "PERMISSION_DENIED", startNote: "Location is off", startLocationSource: "NO_FIX" });
    expect(decision.record.noFix).toEqual({ reason: "Location is off", error: "PERMISSION_DENIED" });
    expect(noFixErrorLabel("PERMISSION_DENIED")).toBe("location is turned off for the app on the phone");
  });

  it("outside 150 m still needs a reason and then proceeds; other starts never accept a refusal", () => {
    const far = evaluateStartLocation({ location: { lat: -33.8, lng: 151.2, accuracy: 10 }, property, tagTapped: false, allowPermissionDenied: true });
    expect(far).toMatchObject({ ok: false, body: { error: "OFF_SITE_REASON_REQUIRED" } });
    const withReason = evaluateStartLocation({ location: { lat: -33.8, lng: 151.2, accuracy: 10, reasonCode: "UNDERGROUND_PARKING" }, property, tagTapped: false });
    expect(noFixSchema.safeParse({ reason: "Location is off", error: "PERMISSION_DENIED" }).success).toBe(false);
    expect(withReason.ok).toBe(true);
    if (withReason.ok) expect(withReason.record.columns).toMatchObject({ startVerdict: "OFF_SITE", startReasonCode: "UNDERGROUND_PARKING" });
  });
});
