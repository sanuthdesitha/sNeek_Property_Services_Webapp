import { describe, expect, it } from "vitest";
import {
  boardStateFor, buildPersonPins, buildPropertyPins, cleanerPin, driverPin, groupOverlappingPins, pinInitials, pinLabel, pinShortName,
  showPropertyLabel, visibleGroupMembers, PROPERTY_LABEL_MIN_ZOOM,
} from "@/components/v2/admin/ops/ops-map-pins";
import type { LivePing } from "@/lib/ops/live-feed-types";
import type { LiveDriverRow, LiveJobRow } from "@/lib/ops/live-board-types";

const NOW = Date.parse("2026-11-13T01:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function ping(overrides: Partial<LivePing> = {}): LivePing {
  return { userId: "u1", user: { name: "Aiko Tanaka" }, lat: -33.88, lng: 151.18, accuracy: 12, timestamp: minutesAgo(1), positionSource: "gps", liveStatus: "ON_SITE", ...overrides };
}

function job(overrides: Partial<LiveJobRow> = {}): LiveJobRow {
  return {
    jobId: "j1", jobNumber: "1", propertyName: "Glebe House", suburb: "Glebe", status: "EN_ROUTE", state: "late", startTime: "10:30", dueTime: null,
    sameDayCheckinTime: null, cleaners: [{ id: "u1", name: "Aiko Tanaka", phone: null }], minutes: 18, etaClock: "10:48",
    distanceMeters: null, elapsedMinutes: null, allocatedMinutes: null, progress: null, openTimeLogId: null,
    field: { address: null, safety: null, checkInDistanceMeters: null, gpsCheckInAt: null },
    ...overrides,
  };
}

function driver(overrides: Partial<LiveDriverRow> = {}): LiveDriverRow {
  return { routeId: "r1", userId: "d1", name: "Tom Smith", phone: null, stopsDone: 2, stopsTotal: 6, lat: -33.9, lng: 151.2, accuracy: 10, lastPingAt: minutesAgo(1), ...overrides };
}

describe("names", () => {
  it("makes initials and short names as drawn", () => {
    expect(pinInitials("Aiko Tanaka")).toBe("AT");
    expect(pinInitials("Aiko T.")).toBe("AT");
    expect(pinInitials("Marco")).toBe("MA");
    expect(pinInitials("  ")).toBe("?");
    expect(pinShortName("Aiko Tanaka")).toBe("Aiko T.");
    expect(pinShortName("Aiko T.")).toBe("Aiko T.");
    expect(pinShortName("Marco")).toBe("Marco");
    expect(pinShortName("Bartholomew-Alexander Smith").length).toBeLessThanOrEqual(16);
    expect(pinShortName(null)).toBe("Unknown");
  });
});

describe("cleaner state → badge tone and label", () => {
  it("late from the board: danger, red pill, minutes in the label", () => {
    const pin = cleanerPin(ping({ liveStatus: "EN_ROUTE" }), [job()], null, NOW)!;
    expect(pin.tone).toBe("danger");
    expect(pin.alert).toBe(true);
    expect(pinLabel(pin)).toBe("Aiko T. · 18 min late");
    expect(pin.ariaLabel).toContain("18 min late");
  });

  it("uses the cleaner's own state over the row's when per-cleaner states exist", () => {
    const row = job({ state: "late", cleaners: [{ id: "u1", name: "A", phone: null }, { id: "u2", name: "B", phone: null }], cleanerStates: [
      { userId: "u1", state: "on-site", liveStatus: "ON_SITE", distanceMeters: null, minutes: null, trackingState: null, lastFixAt: null },
      { userId: "u2", state: "late", liveStatus: "EN_ROUTE", distanceMeters: null, minutes: 20, trackingState: null, lastFixAt: null },
    ] });
    expect(boardStateFor("u1", [row])?.state).toBe("on-site");
    const pin = cleanerPin(ping(), [row], null, NOW)!;
    expect(pin.tone).toBe("success");
    expect(pin.status).toBeNull();
    expect(pinLabel(pin)).toBe("Aiko T.");
  });

  it("off site, on the way and the live status fallback without a board", () => {
    expect(cleanerPin(ping(), [job({ state: "off-site", minutes: 12 })], null, NOW)).toMatchObject({ tone: "warning", status: "off site" });
    expect(cleanerPin(ping(), [job({ state: "travelling" })], null, NOW)).toMatchObject({ tone: "info", status: "on the way" });
    expect(cleanerPin(ping({ liveStatus: "EN_ROUTE" }), [], null, NOW)).toMatchObject({ tone: "info", status: "on the way" });
    expect(cleanerPin(ping({ liveStatus: "LEFT_SITE" }), [], null, NOW)).toMatchObject({ tone: "warning", status: "left site" });
    expect(cleanerPin(ping({ liveStatus: "IDLE" }), [], null, NOW)).toMatchObject({ tone: "neutral", status: null });
  });

  it("started without a fix is never shown as on site, and is said in words", () => {
    const row = job({ state: "on-site", cleanerStates: [{ userId: "u1", state: "on-site", liveStatus: "NO_SIGNAL", distanceMeters: null, minutes: null, trackingState: null, lastFixAt: null, startedWithoutFix: true }] });
    const pin = cleanerPin(ping({ positionSource: "property" }), [row], null, NOW)!;
    expect(pin.tone).toBe("neutral");
    expect(pin.status).toBe("no location fix");
    expect(pin.precision).toBe("job-address");
    expect(pin.qualifier).toBeNull();
    expect(pin.ariaLabel).toContain("started without a location fix");
    expect(pin.ariaLabel).toContain("shown at the job address");
  });
});

describe("position meanings kept from the old markers", () => {
  it("freshness tiers: live, aging (no text, faded badge) and stale (written)", () => {
    expect(cleanerPin(ping({ timestamp: minutesAgo(1) }), [], null, NOW)).toMatchObject({ freshness: "live", qualifier: null });
    const aging = cleanerPin(ping({ timestamp: minutesAgo(6) }), [], null, NOW)!;
    expect(aging).toMatchObject({ freshness: "aging", qualifier: null });
    expect(aging.ariaLabel).toContain("Position aging");
    const stale = cleanerPin(ping({ timestamp: minutesAgo(25) }), [], null, NOW)!;
    expect(stale).toMatchObject({ freshness: "stale", qualifier: "stale fix" });
    expect(pinLabel(stale)).toBe("Aiko T. · stale fix");
    expect(cleanerPin(ping({ timestamp: null }), [], null, NOW)).toMatchObject({ qualifier: "stale fix" });
  });

  it("approximate fix and job-address fallback", () => {
    const approx = cleanerPin(ping({ accuracy: 250 }), [], null, NOW)!;
    expect(approx).toMatchObject({ precision: "approximate", qualifier: "approx." });
    expect(approx.ariaLabel).toContain("approximate (over 100 m)");
    const fallback = cleanerPin(ping({ positionSource: "property" }), [], null, NOW)!;
    expect(fallback).toMatchObject({ precision: "job-address", freshness: "none", qualifier: "no GPS" });
  });

  it("selected state is on the pin and in its name", () => {
    const pin = cleanerPin(ping(), [], "u1", NOW)!;
    expect(pin.selected).toBe(true);
    expect(pin.ariaLabel).toContain("Selected.");
    expect(cleanerPin(ping(), [], "other", NOW)!.selected).toBe(false);
  });

  it("people without a position get no pin", () => {
    expect(cleanerPin(ping({ lat: null, lng: null }), [], null, NOW)).toBeNull();
    expect(driverPin(driver({ lat: null }), null, NOW)).toBeNull();
  });
});

describe("drivers", () => {
  it("gold one-letter badge and 'Driver' in the name", () => {
    const pin = driverPin(driver(), null, NOW)!;
    expect(pin).toMatchObject({ kind: "driver", tone: "gold", initials: "T", shortName: "Driver Tom S." });
    expect(pin.ariaLabel).toContain("laundry driver: stop 3 of 6");
    expect(driverPin(driver({ lastPingAt: minutesAgo(30) }), null, NOW)!.qualifier).toBe("stale fix");
    expect(driverPin(driver({ trackingState: "PERMISSION_OFF" }), null, NOW)!.ariaLabel).toContain("Location permission off");
  });

  it("layers decide which people are built", () => {
    const base = { pings: [ping()], drivers: [driver()], jobs: [], selectedUserId: null, now: NOW };
    expect(buildPersonPins({ ...base, showCleaners: true, showDrivers: true }).map((p) => p.key)).toEqual(["u1", "d1"]);
    expect(buildPersonPins({ ...base, showCleaners: false, showDrivers: true }).map((p) => p.key)).toEqual(["d1"]);
  });
});

describe("overlap grouping", () => {
  const at = (key: string, lat: number, lng: number, rank = 4) => ({ key, lat, lng, rank });

  it("stacks people at about the same place, most urgent first, deterministically", () => {
    const pins = [at("b", -33.86, 151.2), at("a", -33.86001, 151.20001), at("late", -33.86002, 151.2, 0), at("far", -33.95, 151.3)];
    const groups = groupOverlappingPins(pins, 15);
    expect(groups).toHaveLength(2);
    expect(groups[0].members.map((m) => m.key)).toEqual(["late", "a", "b"]);
    expect(groups[0].id).toBe("a|b|late");
    expect(groups[0].lat).toBe(-33.86002);
    expect(groupOverlappingPins([...pins].reverse(), 15)).toEqual(groups);
  });

  it("separates them again when zoomed in far enough", () => {
    const pins = [at("a", -33.86, 151.2), at("b", -33.8605, 151.2006)];
    expect(groupOverlappingPins(pins, 12)).toHaveLength(1);
    expect(groupOverlappingPins(pins, 20)).toHaveLength(2);
  });

  it("a stack's height counts: a pin just above a two-person stack joins it, not above a single pin", () => {
    const above = at("c", -33.8585, 151.2);
    expect(groupOverlappingPins([at("a", -33.86, 151.2), above], 15)).toHaveLength(2);
    const merged = groupOverlappingPins([at("a", -33.86, 151.2), at("b", -33.86, 151.2), above], 15);
    expect(merged).toHaveLength(1);
    expect(merged[0].members.map((m) => m.key)).toEqual(["a", "b", "c"]);
  });

  it("collapsed big groups show two and +N, always including the selected person", () => {
    const group = { id: "x", lat: 0, lng: 0, members: ["a", "b", "c", "d", "e"].map((key) => ({ key })) };
    expect(visibleGroupMembers(group, false, null)).toEqual({ visible: [{ key: "a" }, { key: "b" }], hiddenCount: 3 });
    expect(visibleGroupMembers(group, false, "e").visible.map((m) => m.key)).toEqual(["a", "e"]);
    expect(visibleGroupMembers(group, true, null)).toEqual({ visible: group.members, hiddenCount: 0 });
    const small = { ...group, members: group.members.slice(0, 3) };
    expect(visibleGroupMembers(small, false, null).hiddenCount).toBe(0);
  });
});

describe("properties", () => {
  const props = [
    { name: "Glebe House", suburb: "Glebe", lat: -33.88, lng: 151.18 },
    { name: "Quiet Flat", suburb: "Newtown", lat: -33.9, lng: 151.17 },
    { name: "Twin", suburb: "A", lat: -33.8, lng: 151.1 },
    { name: "Twin", suburb: "B", lat: -33.81, lng: 151.11 },
  ];

  it("takes today's job state from the board rows, matched by name and suburb", () => {
    const pins = buildPropertyPins(props, [job({ state: "on-site" }), job({ jobId: "j9", propertyName: "Twin", suburb: null, state: "late" })]);
    expect(pins[0]).toMatchObject({ todayState: "on-site", todayLabel: "cleaner on site", todayJobId: "j1" });
    expect(pins[0].ariaLabel).toBe("Property: Glebe House, Glebe. Today: cleaner on site.");
    expect(pins[1]).toMatchObject({ todayState: null, todayLabel: null });
    expect(pins[1].ariaLabel).toContain("No job on today's board.");
    // A row without a suburb cannot tell the two "Twin" properties apart.
    expect(pins[2].todayState).toBeNull();
    expect(pins[3].todayState).toBeNull();
  });

  it("names a property only with a job today or when zoomed in", () => {
    const [withJob, without] = buildPropertyPins(props, [job({ state: "planned" })]);
    expect(showPropertyLabel(withJob, 11)).toBe(true);
    expect(showPropertyLabel(without, 11)).toBe(false);
    expect(showPropertyLabel(without, PROPERTY_LABEL_MIN_ZOOM)).toBe(true);
  });
});
