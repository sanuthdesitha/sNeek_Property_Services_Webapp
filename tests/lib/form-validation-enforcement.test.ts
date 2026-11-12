// @vitest-environment node
// The organisation switch for the extended answer checks, and its in-flight rule.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { nextFormValidationSettings, sanitizeFormValidationSettings, shouldEnforceExtended, DEFAULT_FORM_VALIDATION_SETTINGS } from "@/lib/forms/validation-enforcement";
import { extendedEnforcementFor } from "@/lib/forms/validation-enforcement-server";

const on = { enforceExtended: true, enforcedSince: "2026-11-10T00:00:00.000Z" };

describe("form validation switch", () => {
  it("defaults to off and treats unreadable or half-set values as off", () => {
    expect(DEFAULT_FORM_VALIDATION_SETTINGS.enforceExtended).toBe(false);
    expect(sanitizeFormValidationSettings(undefined)).toEqual(DEFAULT_FORM_VALIDATION_SETTINGS);
    expect(sanitizeFormValidationSettings({ enforceExtended: "yes" })).toEqual(DEFAULT_FORM_VALIDATION_SETTINGS);
    expect(sanitizeFormValidationSettings({ enforceExtended: true })).toEqual(DEFAULT_FORM_VALIDATION_SETTINGS);
    expect(sanitizeFormValidationSettings(on)).toEqual(on);
  });
  it("switching on stamps the moment, switching off clears it", () => {
    const now = new Date("2026-11-12T03:00:00Z");
    expect(nextFormValidationSettings(DEFAULT_FORM_VALIDATION_SETTINGS, true, now)).toEqual({ enforceExtended: true, enforcedSince: now.toISOString() });
    expect(nextFormValidationSettings(on, false, now)).toEqual({ enforceExtended: false, enforcedSince: null });
    expect(nextFormValidationSettings(on, true, now)).toBe(on);
  });
  it("enforces only work started at or after the switch; unknown start is not enforced", () => {
    expect(shouldEnforceExtended(on, new Date("2026-11-10T00:00:00.000Z"))).toBe(true);
    expect(shouldEnforceExtended(on, new Date("2026-11-09T23:59:59.999Z"))).toBe(false);
    expect(shouldEnforceExtended(on, null)).toBe(false);
    expect(shouldEnforceExtended(DEFAULT_FORM_VALIDATION_SETTINGS, new Date())).toBe(false);
  });
  it("reads the cleaner's FIRST clock-in, and nothing while off", async () => {
    const findFirst = vi.fn().mockResolvedValue({ startedAt: new Date("2026-11-11T00:00:00Z") });
    await expect(extendedEnforcementFor({ timeLog: { findFirst } } as never, { jobId: "j", userId: "c", settings: on })).resolves.toMatchObject({ enforce: true });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "j", userId: "c" }, orderBy: { startedAt: "asc" } }));
    findFirst.mockClear();
    await extendedEnforcementFor({ timeLog: { findFirst } } as never, { jobId: "j", userId: "c", settings: DEFAULT_FORM_VALIDATION_SETTINGS });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
