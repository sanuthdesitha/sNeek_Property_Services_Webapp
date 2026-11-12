import { describe, expect, it } from "vitest";
import {
  LATE_GRACE_MINUTES,
  NOT_STARTED_GRACE_MINUTES,
  classifyLiveJob,
  projectedArrival,
  wallClockInstant,
  type LiveJobFacts,
} from "@/lib/ops/live-board-rules";

const TZ = "Australia/Sydney";
const base: LiveJobFacts = {
  status: "ASSIGNED", dateKey: "2026-11-11", startTime: "10:30", arrivedAt: null, departedAt: null,
  enRouteEtaMinutes: null, enRouteEtaUpdatedAt: null, hasOpenTimer: false, liveStatus: null,
};
// 10:30 Sydney on 11 Nov 2026 (AEDT, UTC+11) is 23:30 UTC on 10 Nov.
const start = new Date("2026-11-10T23:30:00Z");
const at = (minutesAfterStart: number) => new Date(start.getTime() + minutesAfterStart * 60_000);

describe("wall clock times", () => {
  it("reads HH:mm in the organisation timezone, across daylight saving", () => {
    expect(wallClockInstant("2026-11-11", "10:30", TZ)?.toISOString()).toBe("2026-11-10T23:30:00.000Z");
    expect(wallClockInstant("2026-07-01", "10:30", TZ)?.toISOString()).toBe("2026-07-01T00:30:00.000Z");
    expect(wallClockInstant("2026-10-04", "09:00", TZ)?.toISOString()).toBe("2026-10-03T22:00:00.000Z");
    expect(wallClockInstant("2026-11-11", "late", TZ)).toBeNull();
    expect(wallClockInstant("2026-11-11", null, TZ)).toBeNull();
  });
});

describe("late", () => {
  const travelling = { ...base, status: "EN_ROUTE" };
  it("is not late within the grace period", () => {
    expect(classifyLiveJob(travelling, at(LATE_GRACE_MINUTES), TZ).state).toBe("travelling");
  });
  it("is late once the projected arrival passes start plus grace", () => {
    const result = classifyLiveJob(travelling, at(LATE_GRACE_MINUTES + 1), TZ);
    expect(result).toMatchObject({ state: "late", minutes: LATE_GRACE_MINUTES + 1 });
  });
  it("uses the recorded ETA: early now, but arriving 18 minutes late", () => {
    const facts = { ...travelling, enRouteEtaMinutes: 28, enRouteEtaUpdatedAt: at(-10) };
    const result = classifyLiveJob(facts, at(-5), TZ);
    expect(result.state).toBe("late");
    expect(result.minutes).toBe(18);
    expect(result.projectedArrival?.toISOString()).toBe(at(18).toISOString());
  });
  it("never projects an arrival earlier than now", () => {
    expect(projectedArrival({ enRouteEtaMinutes: 5, enRouteEtaUpdatedAt: at(-60) }, at(0)).toISOString()).toBe(at(0).toISOString());
  });
  it("is not late once arrived", () => {
    expect(classifyLiveJob({ ...travelling, arrivedAt: at(5) }, at(30), TZ).state).toBe("on-site");
  });
});

describe("off site with the clock running", () => {
  it("flags an open timer with the cleaner outside the geofence, with minutes since departure", () => {
    const result = classifyLiveJob({ ...base, status: "IN_PROGRESS", hasOpenTimer: true, liveStatus: "OFF_SITE", departedAt: at(60) }, at(72), TZ);
    expect(result).toMatchObject({ state: "off-site", minutes: 12 });
  });
  it("does not flag without a running clock", () => {
    expect(classifyLiveJob({ ...base, status: "PAUSED", liveStatus: "LEFT_SITE" }, at(72), TZ).state).toBe("on-site");
  });
  it("keeps an on-site clock as on site", () => {
    expect(classifyLiveJob({ ...base, status: "IN_PROGRESS", hasOpenTimer: true, liveStatus: "ON_SITE" }, at(72), TZ).state).toBe("on-site");
  });
});

describe("not started", () => {
  it("waits for the named grace before flagging", () => {
    expect(classifyLiveJob(base, at(NOT_STARTED_GRACE_MINUTES), TZ).state).toBe("planned");
    expect(classifyLiveJob(base, at(NOT_STARTED_GRACE_MINUTES + 1), TZ)).toMatchObject({ state: "not-started", minutes: NOT_STARTED_GRACE_MINUTES + 1 });
  });
  it("covers unassigned jobs too, and never a job with no start time", () => {
    expect(classifyLiveJob({ ...base, status: "UNASSIGNED" }, at(60), TZ).state).toBe("not-started");
    expect(classifyLiveJob({ ...base, startTime: null }, at(600), TZ).state).toBe("planned");
  });
  it("treats submitted and later as done", () => {
    expect(classifyLiveJob({ ...base, status: "SUBMITTED" }, at(600), TZ).state).toBe("done");
  });
});
