import { describe, it, expect } from "vitest";
import { deriveLiveStatus, formatRelativeAgo, LIVE_STALE_AFTER_MS } from "@/lib/ops/live-status";

const NOW = new Date("2026-07-25T10:00:00Z");
const FRESH = new Date(NOW.getTime() - 60_000); // 1 min ago
const STALE = new Date(NOW.getTime() - LIVE_STALE_AFTER_MS - 60_000); // 4 min ago

function derive(overrides: Partial<Parameters<typeof deriveLiveStatus>[0]>) {
  return deriveLiveStatus({
    hasOpenTimer: false,
    jobStatus: null,
    lastPingAt: null,
    insideGeofence: null,
    departedAt: null,
    now: NOW,
    hasGeofence: true,
    ...overrides,
  });
}

describe("formatRelativeAgo", () => {
  it("formats null, just-now, minutes and hours", () => {
    expect(formatRelativeAgo(null, NOW)).toBe("no GPS yet");
    expect(formatRelativeAgo(new Date(NOW.getTime() - 10_000), NOW)).toBe("just now");
    expect(formatRelativeAgo(new Date(NOW.getTime() - 60_000), NOW)).toBe("1 min ago");
    expect(formatRelativeAgo(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 min ago");
    expect(formatRelativeAgo(new Date(NOW.getTime() - 2 * 3_600_000), NOW)).toBe("2 hrs ago");
  });
});

describe("deriveLiveStatus — open timer", () => {
  it("ON_SITE only with fresh ping AND inside fence", () => {
    const r = derive({ hasOpenTimer: true, jobStatus: "IN_PROGRESS", lastPingAt: FRESH, insideGeofence: true });
    expect(r).toEqual({ status: "ON_SITE", label: "On site" });
  });

  it("fresh ping but outside fence → OFF_SITE", () => {
    const r = derive({ hasOpenTimer: true, jobStatus: "IN_PROGRESS", lastPingAt: FRESH, insideGeofence: false });
    expect(r.status).toBe("OFF_SITE");
    expect(r.label).toBe("Clocked in · off site");
  });

  it("no geofence (no property coords): timer + fresh ping → ON_SITE with explicit label", () => {
    const r = derive({ hasOpenTimer: true, jobStatus: "IN_PROGRESS", lastPingAt: FRESH, hasGeofence: false });
    expect(r).toEqual({ status: "ON_SITE", label: "On job (no geofence)" });
  });

  it("stale ping → NO_SIGNAL with relative age", () => {
    const r = derive({ hasOpenTimer: true, jobStatus: "IN_PROGRESS", lastPingAt: STALE, insideGeofence: true });
    expect(r.status).toBe("NO_SIGNAL");
    expect(r.label).toBe("Clocked in · no signal 4 min ago");
  });

  it("no ping at all → NO_SIGNAL", () => {
    const r = derive({ hasOpenTimer: true, jobStatus: "IN_PROGRESS" });
    expect(r.status).toBe("NO_SIGNAL");
    expect(r.label).toBe("Clocked in · no signal no GPS yet");
  });
});

describe("deriveLiveStatus — no timer", () => {
  it("PAUSED without departedAt → Paused · last seen", () => {
    const r = derive({ jobStatus: "PAUSED", lastPingAt: STALE });
    expect(r.status).toBe("PAUSED");
    expect(r.label).toBe("Paused · last seen 4 min ago");
  });

  it("PAUSED with departedAt → Left site label (status stays PAUSED)", () => {
    const departedAt = new Date(NOW.getTime() - 10 * 60_000);
    const r = derive({ jobStatus: "PAUSED", lastPingAt: STALE, departedAt });
    expect(r.status).toBe("PAUSED");
    expect(r.label).toBe("Left site 10 min ago");
  });

  it("departedAt on a non-paused job → LEFT_SITE", () => {
    const departedAt = new Date(NOW.getTime() - 7 * 60_000);
    const r = derive({ jobStatus: "IN_PROGRESS", lastPingAt: STALE, departedAt });
    expect(r).toEqual({ status: "LEFT_SITE", label: "Left site 7 min ago" });
  });

  it("EN_ROUTE passes through", () => {
    const r = derive({ jobStatus: "EN_ROUTE", lastPingAt: FRESH });
    expect(r).toEqual({ status: "EN_ROUTE", label: "En route" });
  });

  it("nothing live → IDLE (property-fallback rows with no ping land here too)", () => {
    expect(derive({})).toEqual({ status: "IDLE", label: "Idle" });
    // Property-coord fallback: has geofence but no ping, no timer, ASSIGNED job.
    expect(derive({ jobStatus: "ASSIGNED", hasGeofence: true }).status).toBe("IDLE");
  });

  it("timer branch outranks PAUSED status (edge: reopened timer on paused job)", () => {
    const r = derive({ hasOpenTimer: true, jobStatus: "PAUSED", lastPingAt: FRESH, insideGeofence: true });
    expect(r.status).toBe("ON_SITE");
  });
});
