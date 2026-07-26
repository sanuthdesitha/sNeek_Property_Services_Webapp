import { describe, it, expect } from "vitest";
import { DEFAULT_QA_PAY_SETTINGS, sanitizeQaPaySettings } from "@/lib/settings";

/**
 * The QA-pay defaults are the LAST fallback in the pay chain, so a malformed
 * stored value must never become the number someone is paid. Every field either
 * parses to a sane, clamped number or falls back — never NaN, never negative.
 */
describe("sanitizeQaPaySettings", () => {
  const fb = DEFAULT_QA_PAY_SETTINGS;

  it("returns the fallback for a non-object", () => {
    expect(sanitizeQaPaySettings(null, fb)).toEqual(fb);
    expect(sanitizeQaPaySettings("nope", fb)).toEqual(fb);
    expect(sanitizeQaPaySettings([], fb)).toEqual(fb);
  });

  it("accepts the three real modes and falls back on anything else", () => {
    expect(sanitizeQaPaySettings({ defaultMode: "FIXED" }, fb).defaultMode).toBe("FIXED");
    expect(sanitizeQaPaySettings({ defaultMode: "NONE" }, fb).defaultMode).toBe("NONE");
    expect(sanitizeQaPaySettings({ defaultMode: "hourly" }, fb).defaultMode).toBe(fb.defaultMode);
    expect(sanitizeQaPaySettings({ defaultMode: 7 }, fb).defaultMode).toBe(fb.defaultMode);
  });

  it("clamps negatives to zero rather than paying a negative rate", () => {
    const out = sanitizeQaPaySettings(
      { defaultFixedAmount: -50, defaultHourlyRate: -1, defaultHoursPerInspection: -3 },
      fb
    );
    expect(out.defaultFixedAmount).toBe(0);
    expect(out.defaultHourlyRate).toBe(0);
    expect(out.defaultHoursPerInspection).toBe(0);
  });

  it("clamps absurd upper values", () => {
    const out = sanitizeQaPaySettings(
      { defaultFixedAmount: 1e9, defaultHourlyRate: 1e9, defaultHoursPerInspection: 999 },
      fb
    );
    expect(out.defaultFixedAmount).toBe(10000);
    expect(out.defaultHourlyRate).toBe(1000);
    expect(out.defaultHoursPerInspection).toBe(24);
  });

  it("falls back on non-numeric input instead of producing NaN", () => {
    const out = sanitizeQaPaySettings(
      { defaultHourlyRate: "forty", defaultHoursPerInspection: undefined },
      fb
    );
    expect(out.defaultHourlyRate).toBe(fb.defaultHourlyRate);
    expect(out.defaultHoursPerInspection).toBe(fb.defaultHoursPerInspection);
    expect(Number.isNaN(out.defaultHourlyRate)).toBe(false);
  });

  it("keeps an explicit 0 (a real 'not configured' signal, not a fallback trigger)", () => {
    expect(sanitizeQaPaySettings({ defaultFixedAmount: 0 }, fb).defaultFixedAmount).toBe(0);
  });

  it("the shipped default is a usable hourly configuration", () => {
    expect(DEFAULT_QA_PAY_SETTINGS.defaultMode).toBe("HOURLY");
    expect(DEFAULT_QA_PAY_SETTINGS.defaultHourlyRate).toBeGreaterThan(0);
    expect(DEFAULT_QA_PAY_SETTINGS.defaultHoursPerInspection).toBeGreaterThan(0);
  });
});
