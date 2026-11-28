// @vitest-environment node
/**
 * Pilot features (2026-11-28): Off by default, unreadable = Off, scoped to
 * people and/or properties, and a job started before a pilot was switched on
 * (or its scope last changed) keeps the previous flow.
 */
import { describe, expect, it } from "vitest";
import { PILOTS, PILOT_KEYS, parsePilotState, pilotApplies, pilotSettingApplies, type PilotSetting } from "@/lib/pilots/registry";

const ON_SINCE = "2026-11-28T00:00:00.000Z";
const setting = (patch: Partial<PilotSetting>): PilotSetting => ({ mode: "OFF", userIds: [], propertyIds: [], onSince: null, changedAt: null, changedById: null, ...patch });

describe("pilot registry", () => {
  it("defines every pilot once with plain words, and each is Off when nothing is saved", () => {
    expect(PILOTS.map((pilot) => pilot.key)).toEqual([...PILOT_KEYS]);
    for (const pilot of PILOTS) expect(pilot.name && pilot.description && pilot.whenOff && pilot.affects, pilot.key).toBeTruthy();
    const state = parsePilotState(null);
    expect(state.readable).toBe(true);
    for (const key of PILOT_KEYS) expect(pilotApplies(state, key, { userId: "u", propertyId: "p" }), key).toBe(false);
  });

  it("counts an unreadable state as Off: the whole value, or one malformed pilot", () => {
    const broken = parsePilotState("garbage");
    expect(broken.readable).toBe(false);
    expect(pilotApplies(broken, "unused-check", { userId: "u" })).toBe(false);
    const partly = parsePilotState({ "unused-check": { mode: "MAYBE" }, "property-reminders": setting({ mode: "ON", onSince: ON_SINCE }) });
    expect(partly.unreadable).toEqual(["unused-check"]);
    expect(pilotApplies(partly, "unused-check", { userId: "u" })).toBe(false);
    expect(pilotApplies(partly, "property-reminders", { userId: "u" })).toBe(true);
  });

  it("applies On for everyone, and Scoped only to the chosen people or properties", () => {
    expect(pilotSettingApplies(setting({ mode: "ON" }), {})).toBe(true);
    const scoped = setting({ mode: "SCOPED", userIds: ["cleaner-a"], propertyIds: ["property-1"] });
    expect(pilotSettingApplies(scoped, { userId: "cleaner-a", propertyId: "property-9" })).toBe(true);
    expect(pilotSettingApplies(scoped, { userId: "cleaner-b", propertyId: "property-1" })).toBe(true);
    expect(pilotSettingApplies(scoped, { userId: "cleaner-b", propertyId: "property-9" })).toBe(false);
    expect(pilotSettingApplies(scoped, {})).toBe(false);
    expect(pilotSettingApplies(setting({ mode: "OFF", userIds: ["cleaner-a"] }), { userId: "cleaner-a" })).toBe(false);
  });

  it("does not apply to a job started before it was switched on, and does to one started after", () => {
    const on = setting({ mode: "ON", onSince: ON_SINCE });
    expect(pilotSettingApplies(on, { jobStartedAt: new Date("2026-11-27T23:00:00Z") })).toBe(false);
    expect(pilotSettingApplies(on, { jobStartedAt: new Date("2026-11-28T01:00:00Z") })).toBe(true);
    expect(pilotSettingApplies(on, { jobStartedAt: null })).toBe(true);
  });
});
