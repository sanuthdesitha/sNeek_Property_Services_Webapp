import { describe, expect, it } from "vitest";
import { STREAM_STALE_AFTER_MS, freshestPositionAgeSeconds, mergeSnapshot, streamIndicator, type LivePing } from "@/lib/ops/live-feed-types";
import { opsMapRedirectTarget } from "@/lib/ops/ops-map-redirect";

const TZ = "Australia/Sydney";
const NOW = Date.parse("2026-11-11T01:00:00Z"); // 12:00 Sydney

describe("stream indicator", () => {
  it("is live while messages (or heartbeats) keep arriving", () => {
    expect(streamIndicator({ mode: "open", lastMessageAt: NOW - 30_000, lastSnapshotAt: null, now: NOW, timeZone: TZ })).toEqual({ tone: "ok", label: "Live" });
  });
  it("says stale since the last message once the stream goes quiet", () => {
    const last = NOW - STREAM_STALE_AFTER_MS - 1000;
    expect(streamIndicator({ mode: "open", lastMessageAt: last, lastSnapshotAt: null, now: NOW, timeZone: TZ })).toEqual({ tone: "bad", label: "Stale since 11:57" });
  });
  it("says reconnecting after an error, with the last update time", () => {
    expect(streamIndicator({ mode: "error", lastMessageAt: NOW - 60_000, lastSnapshotAt: null, now: NOW, timeZone: TZ })).toEqual({ tone: "warn", label: "Reconnecting · last update 11:59" });
  });
  it("never claims live when the stream is off; it names the polling instead", () => {
    expect(streamIndicator({ mode: "off", lastMessageAt: null, lastSnapshotAt: NOW, now: NOW, timeZone: TZ }).label).toBe("Refreshing every 15 s · updated 12:00");
  });
});

describe("positions", () => {
  const ping = (userId: string, at: string | null, source: LivePing["positionSource"] = "gps"): LivePing => ({ userId, lat: 1, lng: 1, timestamp: at, lastPingAt: at, positionSource: source });
  it("reports the age of the freshest GPS position only", () => {
    expect(freshestPositionAgeSeconds([ping("a", "2026-11-11T00:59:40Z"), ping("b", "2026-11-11T00:50:00Z"), ping("c", null, "property")], NOW)).toBe(20);
    expect(freshestPositionAgeSeconds([ping("c", null, "property")], NOW)).toBeNull();
  });
  it("keeps a newer streamed position over an older snapshot", () => {
    const merged = mergeSnapshot([{ ...ping("a", "2026-11-11T00:59:50Z"), lat: 9 }], [{ ...ping("a", "2026-11-11T00:59:00Z"), lat: 2, liveLabel: "On site" }]);
    expect(merged[0]).toMatchObject({ lat: 9, liveLabel: "On site" });
  });
});

describe("/v2/admin/ops/map redirect", () => {
  it("sends today's map to Live ops and keeps other parameters", () => {
    expect(opsMapRedirectTarget({}, "2026-11-11")).toBe("/v2/admin/ops");
    expect(opsMapRedirectTarget({ date: "2026-11-11", view: "onsite" }, "2026-11-11")).toBe("/v2/admin/ops?view=onsite");
  });
  it("sends another day's map to the route map for that day", () => {
    expect(opsMapRedirectTarget({ date: "2026-11-12" }, "2026-11-11")).toBe("/v2/admin/jobs/route-map?date=2026-11-12");
  });
  it("ignores a malformed date", () => {
    expect(opsMapRedirectTarget({ date: "tomorrow" }, "2026-11-11")).toBe("/v2/admin/ops");
  });
});
