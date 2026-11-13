// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateCleanerJobWindow, evaluateDriverRouteWindow } from "@/lib/gps/tracking-window";
import { fenceVerdict, judgeFix, passiveGeofenceRadius } from "@/lib/gps/geofence-policy";
import { clockOffsetMs, correctFixes, isLiveFix, parseLocationBatch } from "@/lib/gps/ingest";
import { freshnessTier, isApproximateFix, locationFreshness, trackingStateLabel } from "@/lib/gps/staleness";
import { interpretFlushResponse, shouldQueueFix, shouldRestartWatch, trackingStateFor } from "@/lib/gps/tracker-core";
import { advanceStreamCursor, streamCursorWhere } from "@/lib/ops/live-stream";
import { liveAccessFor } from "@/lib/ops/live-access";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { evaluateStartLocation } from "@/lib/gps/start-location";
import { deriveLiveStatus } from "@/lib/ops/live-status";
import { spreadOverlapping } from "@/components/v2/admin/ops/estate-ops-map-parts";

// 12:00 Sydney on 13 Nov 2026.
const NOW = new Date("2026-11-13T01:00:00Z");
const TODAY = new Date("2026-11-13T00:00:00Z");
const YESTERDAY = new Date("2026-11-12T00:00:00Z");
const facts = (over: Partial<Parameters<typeof evaluateCleanerJobWindow>[0]> = {}) => ({
  status: "EN_ROUTE", scheduledDate: TODAY, assigned: true, cleanSkipped: false, ownOpenTimerStartedAt: null, ...over,
});

describe("tracking window", () => {
  it("tracks a cleaner from on the way, and while their own clock runs, on today's job", () => {
    expect(evaluateCleanerJobWindow(facts(), { now: NOW, impersonating: false })).toMatchObject({ ok: true, source: "CLEANER_DRIVING" });
    expect(evaluateCleanerJobWindow(facts({ status: "IN_PROGRESS", ownOpenTimerStartedAt: new Date("2026-11-12T23:00:00Z") }), { now: NOW, impersonating: false })).toMatchObject({ ok: true, source: "CLEANER_JOB" });
  });
  it.each([
    ["paused with no running clock", facts({ status: "PAUSED" }), "CLOCK_STOPPED"],
    ["in progress on a teammate's clock only", facts({ status: "IN_PROGRESS" }), "CLOCK_STOPPED"],
    ["yesterday's job", facts({ scheduledDate: YESTERDAY }), "NOT_TODAY"],
    ["submitted", facts({ status: "SUBMITTED", ownOpenTimerStartedAt: new Date("2026-11-12T23:00:00Z") }), "NOT_TRACKED_STATUS"],
    ["skipped", facts({ cleanSkipped: true }), "NOT_TRACKED_STATUS"],
    ["not assigned", facts({ assigned: false }), "NOT_ASSIGNED"],
  ])("never tracks %s", (_label, input, reason) => {
    expect(evaluateCleanerJobWindow(input, { now: NOW, impersonating: false })).toEqual({ ok: false, reason });
  });
  it("never tracks while impersonated", () => {
    expect(evaluateCleanerJobWindow(facts(), { now: NOW, impersonating: true })).toEqual({ ok: false, reason: "IMPERSONATING" });
  });
  it("keeps a clock that started today after midnight on yesterday's late job", () => {
    expect(evaluateCleanerJobWindow(facts({ status: "IN_PROGRESS", scheduledDate: YESTERDAY, ownOpenTimerStartedAt: new Date("2026-11-12T14:00:00Z") }), { now: NOW, impersonating: false }).ok).toBe(true);
  });
  it("tracks a driver only on an ACTIVE route today with stops, never office roles or impersonation", () => {
    const route = { status: "ACTIVE", date: TODAY, stops: [{ taskId: "t", kind: "PICKUP", order: 0, propertyId: "p" }] };
    expect(evaluateDriverRouteWindow(route, { now: NOW, impersonating: false, role: "LAUNDRY" })).toEqual({ ok: true });
    expect(evaluateDriverRouteWindow({ ...route, status: "DRAFT" }, { now: NOW, impersonating: false, role: "LAUNDRY" })).toEqual({ ok: false, reason: "NO_ACTIVE_ROUTE" });
    expect(evaluateDriverRouteWindow({ ...route, date: YESTERDAY }, { now: NOW, impersonating: false, role: "LAUNDRY" })).toEqual({ ok: false, reason: "NO_ACTIVE_ROUTE" });
    expect(evaluateDriverRouteWindow(route, { now: NOW, impersonating: false, role: "ADMIN" })).toEqual({ ok: false, reason: "WRONG_ROLE" });
    expect(evaluateDriverRouteWindow(route, { now: NOW, impersonating: true, role: "LAUNDRY" })).toEqual({ ok: false, reason: "IMPERSONATING" });
  });
});

describe("geofence policy", () => {
  it("uses the property radius, ignores imprecise fixes and has a hysteresis band", () => {
    expect(passiveGeofenceRadius(null)).toBe(75);
    expect(passiveGeofenceRadius(300)).toBe(300);
    expect(fenceVerdict({ distanceM: 50, accuracyM: 10, radiusM: 75 })).toBe("INSIDE");
    expect(fenceVerdict({ distanceM: 90, accuracyM: 10, radiusM: 75 })).toBe("UNKNOWN");
    expect(fenceVerdict({ distanceM: 120, accuracyM: 10, radiusM: 75 })).toBe("OUTSIDE");
    expect(fenceVerdict({ distanceM: 120, accuracyM: 300, radiusM: 75 })).toBe("UNKNOWN");
    expect(fenceVerdict({ distanceM: 250, accuracyM: 10, radiusM: 300 })).toBe("INSIDE");
    expect(judgeFix({ lat: 1, lng: 1 }, { latitude: null, longitude: null }).verdict).toBe("UNKNOWN");
  });
  it("live status calls an imprecise fix approximate, never off site", () => {
    const base = { hasOpenTimer: true, jobStatus: "IN_PROGRESS", lastPingAt: new Date(NOW.getTime() - 60_000), departedAt: null, now: NOW, hasGeofence: true };
    expect(deriveLiveStatus({ ...base, insideGeofence: null }).status).toBe("UNCERTAIN");
    expect(deriveLiveStatus({ ...base, insideGeofence: false }).status).toBe("OFF_SITE");
    expect(deriveLiveStatus({ ...base, lastPingAt: new Date(NOW.getTime() - 20 * 60_000), insideGeofence: true, trackingState: "PERMISSION_OFF" }).label).toContain("location permission off");
  });
});

describe("ingest: clock skew, backlog and drop reasons", () => {
  const floor = new Date("2026-11-12T13:00:00Z");
  it("parses the envelope, a bare array and a single fix with sentAt", () => {
    expect(parseLocationBatch({ sentAt: NOW.toISOString(), pings: [{ clientId: "a", jobId: "j", lat: 1, lng: 2 }], state: { state: "BACKGROUND" } })).toMatchObject({ ok: true, batch: { fixes: [{ clientId: "a" }], state: { state: "BACKGROUND" } } });
    expect(parseLocationBatch([{ jobId: "j", lat: 1, lng: 2 }])).toMatchObject({ ok: true, batch: { sentAt: null } });
    expect(parseLocationBatch({ lat: 1, lng: 2, sentAt: NOW.toISOString() })).toMatchObject({ ok: true, batch: { sentAt: NOW, fixes: [{ lat: 1 }] } });
    expect(parseLocationBatch({ pings: [{ lat: 100, lng: 2 }] }).ok).toBe(false);
    expect(parseLocationBatch({ state: { state: "SOMETHING" } }).ok).toBe(false);
  });
  it("corrects a phone clock five minutes slow instead of dropping every fix", () => {
    const sentAt = new Date(NOW.getTime() - 5 * 60_000);
    const { accepted, dropped } = correctFixes([{ lat: 1, lng: 2, timestamp: new Date(sentAt.getTime() - 10_000).toISOString() }], { sentAt, receivedAt: NOW, notBefore: floor });
    expect(dropped).toEqual({});
    expect(accepted[0].measuredAt.toISOString()).toBe(new Date(NOW.getTime() - 10_000).toISOString());
    expect(isLiveFix(accepted[0].measuredAt, NOW)).toBe(true);
  });
  it("accepts a backlog as history (not live) and counts what it drops", () => {
    const fixes = [
      { lat: 1, lng: 2, timestamp: new Date(NOW.getTime() - 40 * 60_000).toISOString() },
      { lat: 1, lng: 2, timestamp: new Date(NOW.getTime() + 10 * 60_000).toISOString() },
      { lat: 1, lng: 2, timestamp: new Date("2026-11-12T10:00:00Z").toISOString() },
    ];
    const { accepted, dropped } = correctFixes(fixes, { sentAt: NOW, receivedAt: NOW, notBefore: floor });
    expect(accepted).toHaveLength(1);
    expect(isLiveFix(accepted[0].measuredAt, NOW)).toBe(false);
    expect(dropped).toEqual({ FUTURE: 1, TOO_OLD: 1 });
  });
  it("refuses a phone clock days out", () => {
    expect(clockOffsetMs(new Date("2026-11-01T00:00:00Z"), NOW)).toBeNull();
    expect(correctFixes([{ lat: 1, lng: 2 }], { sentAt: new Date("2026-11-01T00:00:00Z"), receivedAt: NOW, notBefore: floor }).dropped).toEqual({ CLOCK_UNTRUSTED: 1 });
  });
});

describe("one staleness policy", () => {
  it("judges from the measured time", () => {
    expect(locationFreshness(new Date(Date.now() - 60_000))).toBe("live");
    expect(locationFreshness(new Date(Date.now() - 5 * 60_000))).toBe("aging");
    expect(locationFreshness(new Date(Date.now() - 30 * 60_000))).toBe("stale");
    expect(locationFreshness(null)).toBe("none");
    expect(freshnessTier(null).key).toBe("stale");
    expect(isApproximateFix(150)).toBe(true);
    expect(isApproximateFix(null)).toBe(false);
    expect(trackingStateLabel("SHARING")).toBeNull();
    expect(trackingStateLabel("BACKGROUND")).toBe("App in the background");
  });
});

describe("tracker decisions", () => {
  it("throttles, interprets responses, reports state and restarts a stalled watch", () => {
    expect(shouldQueueFix(null, { lat: 1, lng: 1 }, 0)).toBe(true);
    expect(shouldQueueFix({ lat: 1, lng: 1, queuedAt: 0 }, { lat: 1, lng: 1 }, 5_000)).toBe(false);
    expect(shouldQueueFix({ lat: 1, lng: 1, queuedAt: 0 }, { lat: 1.001, lng: 1 }, 5_000)).toBe(true);
    expect(interpretFlushResponse(200, { window: { active: false } })).toEqual({ kind: "clear", windowClosed: true, arrivedStop: null });
    expect(interpretFlushResponse(200, { arrivedStop: { taskId: "t", kind: "DROP" } })).toMatchObject({ arrivedStop: { taskId: "t", kind: "DROP" } });
    expect(interpretFlushResponse(400, null).kind).toBe("clear");
    expect(interpretFlushResponse(429, { retryAfterMs: 3000 })).toEqual({ kind: "retain", retryAfterMs: 3000 });
    expect(interpretFlushResponse(503, null).kind).toBe("retain");
    expect(trackingStateFor({ permission: "denied", visible: true, online: true, unavailable: false })).toBe("PERMISSION_OFF");
    expect(trackingStateFor({ permission: "granted", visible: false, online: true, unavailable: false })).toBe("BACKGROUND");
    expect(trackingStateFor({ permission: "granted", visible: true, online: false, unavailable: false })).toBe("OFFLINE");
    expect(trackingStateFor({ permission: "granted", visible: true, online: true, unavailable: true })).toBe("UNAVAILABLE");
    expect(shouldRestartWatch({ visible: true, watchAlive: false, lastFixAt: null, now: 0, permission: "granted" })).toBe(true);
    expect(shouldRestartWatch({ visible: true, watchAlive: true, lastFixAt: 0, now: 3 * 60_000, permission: "granted" })).toBe(true);
    expect(shouldRestartWatch({ visible: false, watchAlive: false, lastFixAt: null, now: 0, permission: "granted" })).toBe(false);
    expect(shouldRestartWatch({ visible: true, watchAlive: false, lastFixAt: null, now: 0, permission: "denied" })).toBe(false);
  });
});

describe("live stream cursor", () => {
  it("reads by server receive time then id, so a late-flushed fix is streamed exactly once", () => {
    const at = new Date("2026-11-13T00:00:00Z");
    expect(streamCursorWhere({ receivedAt: at, id: "b" })).toEqual({ OR: [{ receivedAt: { gt: at } }, { receivedAt: at, id: { gt: "b" } }] });
    expect(advanceStreamCursor({ receivedAt: at, id: "" }, [{ receivedAt: at, id: "a" }, { receivedAt: at, id: "c" }])).toEqual({ receivedAt: at, id: "c" });
    expect(advanceStreamCursor({ receivedAt: at, id: "x" }, [])).toEqual({ receivedAt: at, id: "x" });
  });
});

describe("Live ops access for operations managers", () => {
  it("opens Live ops with the Dashboard pack, not System; other ops tools stay System", () => {
    for (const path of ["/v2/admin/ops", "/admin/ops", "/v2/admin/ops/map", "/api/admin/ops/live-board", "/api/admin/ops/live-locations", "/api/admin/ops/live-locations/stream", "/api/admin/ops/live-locations/trail"]) {
      expect(opsRequestFeature(path), path).toBe("dashboard");
    }
    expect(opsRequestFeature("/api/admin/ops/sla/run")).toBe("system");
    const dashboardOnly = { ...allOpsLevels("off"), dashboard: "read" as const };
    expect(canUseOpsPath(dashboardOnly, "/v2/admin/ops")).toBe(true);
    expect(canUseOpsPath(dashboardOnly, "/api/admin/ops/live-board")).toBe(true);
    expect(canUseOpsPath({ ...allOpsLevels("manage"), dashboard: "off" }, "/v2/admin/ops")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("manage"), system: "off" }, "/v2/admin/ops")).toBe(true);
  });
  it("filters drivers by Laundry, continuations by Approvals, actions by Jobs at manage; ADMIN sees all", () => {
    expect(liveAccessFor(null)).toEqual({ live: true, drivers: true, continuations: true, jobActions: true });
    expect(liveAccessFor({ ...allOpsLevels("off"), dashboard: "read" })).toEqual({ live: true, drivers: false, continuations: false, jobActions: false });
    expect(liveAccessFor({ ...allOpsLevels("off"), dashboard: "read", laundry: "read", approvals: "manage", jobs: "read" })).toEqual({ live: true, drivers: true, continuations: true, jobActions: false });
    expect(liveAccessFor({ ...allOpsLevels("manage"), dashboard: "off" }).live).toBe(false);
  });
});

describe("per-segment start location", () => {
  const property = { name: "P", latitude: -33.86, longitude: 151.2, geofenceRadiusM: null };
  it("requires a fix or a tag, judges per segment and needs a reason off site", () => {
    expect(evaluateStartLocation({ location: null, property, tagTapped: false })).toMatchObject({ ok: false, body: { error: "LOCATION_REQUIRED" } });
    expect(evaluateStartLocation({ location: null, property, tagTapped: true })).toMatchObject({ ok: true, record: { columns: { startLocationSource: "NFC" } } });
    expect(evaluateStartLocation({ location: { lat: -33.9, lng: 151.2, accuracy: 10 }, property, tagTapped: false })).toMatchObject({ ok: false, body: { error: "OFF_SITE_REASON_REQUIRED" } });
    expect(evaluateStartLocation({ location: { lat: -33.9, lng: 151.2, accuracy: 10, reasonCode: "WRONG_PIN" }, property, tagTapped: false })).toMatchObject({ ok: true, record: { columns: { startVerdict: "OFF_SITE", startReasonCode: "WRONG_PIN" } } });
    expect(evaluateStartLocation({ location: { lat: -33.9, lng: 151.2, accuracy: 900 }, property, tagTapped: false })).toMatchObject({ ok: true, record: { columns: { startVerdict: "UNRELIABLE" } } });
    expect(evaluateStartLocation({ location: { lat: 1, lng: 1 }, property: { latitude: null, longitude: null }, tagTapped: false })).toMatchObject({ ok: true, record: { columns: { startVerdict: "NO_GEOFENCE" } } });
  });
});

describe("map grouping", () => {
  it("spreads people at the same spot so each stays clickable", () => {
    const placed = spreadOverlapping([{ key: "a", lat: -33.86, lng: 151.2 }, { key: "b", lat: -33.86001, lng: 151.20001 }, { key: "c", lat: -33.9, lng: 151.2 }]);
    const a = placed.find((p) => p.key === "a")!;
    const b = placed.find((p) => p.key === "b")!;
    expect(a.groupSize).toBe(2);
    expect(a.displayLat === b.displayLat && a.displayLng === b.displayLng).toBe(false);
    expect(placed.find((p) => p.key === "c")).toMatchObject({ groupSize: 1, displayLat: -33.9 });
  });
});
