// @vitest-environment node
/**
 * Property devices (2026-11-20): the low-battery rule as pure functions.
 * Threshold boundary and overrides, unknown and stale readings, wired and
 * inactive devices, the cool-down after a charge, and which readings may
 * close a condition.
 */
import { describe, expect, it } from "vitest";
import { chargeTaskTitle, decideCharge, DEFAULT_DEVICE_SETTINGS, deviceBatteryStatus, effectiveThreshold, type ChargeDecisionInput } from "@/lib/property-devices/charge-policy";
import { batteryText } from "@/lib/property-devices/types";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const settings = { staleAfterHours: 48, cooldownHours: 72 };

function input(overrides: Partial<ChargeDecisionInput> = {}): ChargeDecisionInput {
  return {
    isActive: true,
    batteryPowered: true,
    online: true,
    reading: { percent: 18, readAt: hoursAgo(1), source: "PROVIDER" },
    thresholdPercent: 25,
    condition: "NONE",
    conditionOpenedAt: null,
    chargedAt: null,
    hasOpenTask: false,
    ...overrides,
  };
}

describe("threshold", () => {
  it("25% raises at a 25% threshold; 26% does not", () => {
    expect(decideCharge(input({ reading: { percent: 25, readAt: hoursAgo(1), source: "PROVIDER" } }), NOW, settings).action).toBe("RAISE");
    expect(decideCharge(input({ reading: { percent: 26, readAt: hoursAgo(1), source: "PROVIDER" } }), NOW, settings).action).toBe("NONE");
  });

  it("the device override wins over the property's, which wins over the organisation's", () => {
    expect(effectiveThreshold({ deviceThreshold: 40, propertyThreshold: 30, organisationThreshold: 25 })).toBe(40);
    expect(effectiveThreshold({ deviceThreshold: null, propertyThreshold: 30, organisationThreshold: 25 })).toBe(30);
    expect(effectiveThreshold({ deviceThreshold: null, propertyThreshold: null, organisationThreshold: 25 })).toBe(25);
    expect(DEFAULT_DEVICE_SETTINGS.defaultThresholdPercent).toBe(25);
    // 35% is low for a device whose own threshold is 40.
    expect(decideCharge(input({ reading: { percent: 35, readAt: hoursAgo(1), source: "MANUAL" }, thresholdPercent: 40 }), NOW, settings).action).toBe("RAISE");
  });
});

describe("unknown, stale, wired and inactive", () => {
  it("an unknown battery never raises and shows as Not known, never 0%", () => {
    expect(decideCharge(input({ reading: { percent: null, readAt: null, source: null } }), NOW, settings).action).toBe("NONE");
    expect(deviceBatteryStatus({ isActive: true, batteryPowered: true, online: null, reading: { percent: null, readAt: null, source: null }, thresholdPercent: 25 }, NOW, 48)).toBe("UNKNOWN");
    expect(batteryText(null)).toBe("Not known");
    expect(batteryText(0)).toBe("0%");
  });

  it("a stale low reading neither raises nor keeps the device looking current", () => {
    const stale = { percent: 5, readAt: hoursAgo(49), source: "PROVIDER" as const };
    expect(decideCharge(input({ reading: stale }), NOW, settings).action).toBe("NONE");
    expect(deviceBatteryStatus({ isActive: true, batteryPowered: true, online: true, reading: stale, thresholdPercent: 25 }, NOW, 48)).toBe("STALE");
  });

  it("a stale high reading does not clear an open condition", () => {
    const decision = decideCharge(input({ reading: { percent: 90, readAt: hoursAgo(60), source: "PROVIDER" }, condition: "NEEDS_CHARGE", conditionOpenedAt: hoursAgo(70), hasOpenTask: true }), NOW, settings);
    expect(decision.action).toBe("NONE");
  });

  it("a wired or inactive device never raises", () => {
    expect(decideCharge(input({ batteryPowered: false, reading: { percent: 1, readAt: hoursAgo(1), source: "PROVIDER" } }), NOW, settings).action).toBe("NONE");
    expect(decideCharge(input({ isActive: false }), NOW, settings).action).toBe("NONE");
  });

  it("offline wins over a battery number of unknown age", () => {
    expect(deviceBatteryStatus({ isActive: true, batteryPowered: true, online: false, reading: { percent: 80, readAt: hoursAgo(1), source: "PROVIDER" }, thresholdPercent: 25 }, NOW, 48)).toBe("OFFLINE");
  });
});

describe("open conditions", () => {
  it("an open condition with a task does nothing more; without its task the task is created again", () => {
    expect(decideCharge(input({ condition: "NEEDS_CHARGE", conditionOpenedAt: hoursAgo(2), hasOpenTask: true }), NOW, settings).action).toBe("NONE");
    expect(decideCharge(input({ condition: "NEEDS_CHARGE", conditionOpenedAt: hoursAgo(2), hasOpenTask: false }), NOW, settings).action).toBe("ENSURE_TASK");
  });

  it("a later provider or office reading above the threshold closes it; a cleaner's does not", () => {
    const open = { condition: "NEEDS_CHARGE" as const, conditionOpenedAt: hoursAgo(5), hasOpenTask: true };
    expect(decideCharge(input({ ...open, reading: { percent: 80, readAt: hoursAgo(1), source: "PROVIDER" } }), NOW, settings).action).toBe("CLOSE_RECOVERED");
    expect(decideCharge(input({ ...open, reading: { percent: 80, readAt: hoursAgo(1), source: "MANUAL" } }), NOW, settings).action).toBe("CLOSE_RECOVERED");
    expect(decideCharge(input({ ...open, reading: { percent: 80, readAt: hoursAgo(1), source: "CLEANER" } }), NOW, settings).action).toBe("NONE");
    // Not newer than the low reading: nothing.
    expect(decideCharge(input({ ...open, reading: { percent: 80, readAt: hoursAgo(6), source: "PROVIDER" } }), NOW, settings).action).toBe("NONE");
  });

  it("after a charge, a still-low reading raises again only after the cool-down and only when newer than the charge", () => {
    const charged = { condition: "CHARGED_AWAITING_CONFIRMATION" as const, conditionOpenedAt: hoursAgo(100) };
    // Charged 10 hours ago, reading since then still low: within the 72 h cool-down.
    expect(decideCharge(input({ ...charged, chargedAt: hoursAgo(10), reading: { percent: 20, readAt: hoursAgo(1), source: "PROVIDER" } }), NOW, settings).action).toBe("NONE");
    // Charged 80 hours ago, reading 1 hour ago still low: raise.
    expect(decideCharge(input({ ...charged, chargedAt: hoursAgo(80), reading: { percent: 20, readAt: hoursAgo(1), source: "PROVIDER" } }), NOW, { staleAfterHours: 200, cooldownHours: 72 }).action).toBe("RAISE");
    // Cool-down passed but no reading since the charge: nothing.
    expect(decideCharge(input({ ...charged, chargedAt: hoursAgo(80), reading: { percent: 20, readAt: hoursAgo(90), source: "PROVIDER" } }), NOW, { staleAfterHours: 200, cooldownHours: 72 }).action).toBe("NONE");
  });
});

it("words the task the way the owner asked", () => {
  expect(chargeTaskTitle({ providerLabel: "Ring", kindLabel: "Camera", deviceName: "Front door", percent: 18 })).toBe("Charge the Ring camera: Front door (18%)");
  expect(chargeTaskTitle({ providerLabel: null, kindLabel: "Smoke alarm", deviceName: "Hallway", percent: 10 })).toBe("Charge the smoke alarm: Hallway (10%)");
});
