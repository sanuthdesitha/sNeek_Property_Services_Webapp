import { describe, expect, it } from "vitest";
import {
  EMAIL_AUTO_KIND_KEYS,
  isAudienceKindAllowed,
  isAutoEmailAllowed,
  sanitizeEmailAutomation,
} from "@/lib/notifications/email-kinds";

/**
 * The gate is a chain of narrowing decisions — master, kind, audience×kind,
 * then the person's own preference — and every link must fail OPEN on absence.
 * A switch that blocks by omission would silently stop mail nobody chose to
 * stop, which is indistinguishable from the system being broken.
 */
describe("email automation settings", () => {
  it("allows a kind for an audience with no matrix at all", () => {
    const settings = sanitizeEmailAutomation({});
    expect(isAudienceKindAllowed(settings, "CLEANER", "job_reminder")).toBe(true);
  });

  it("blocks only the exact audience+kind cell that was unticked", () => {
    const settings = sanitizeEmailAutomation({
      audienceKinds: { CLEANER: { inventory_update: false } },
    });

    expect(isAudienceKindAllowed(settings, "CLEANER", "inventory_update")).toBe(false);
    // Same kind, different audience — the ops manager still needs it.
    expect(isAudienceKindAllowed(settings, "ADMIN", "inventory_update")).toBe(true);
    // Same audience, different kind.
    expect(isAudienceKindAllowed(settings, "CLEANER", "job_reminder")).toBe(true);
  });

  it("treats a missing audience, kind or settings object as allowed", () => {
    const settings = sanitizeEmailAutomation({ audienceKinds: { CLEANER: { x: false } } });
    expect(isAudienceKindAllowed(undefined, "CLEANER", "x")).toBe(true);
    expect(isAudienceKindAllowed(settings, null, "x")).toBe(true);
    expect(isAudienceKindAllowed(settings, "CLEANER", null)).toBe(true);
  });

  it("keeps an unrecognised audience or kind rather than dropping it", () => {
    // Dropping unknown pairs on load would re-enable a kind an admin had
    // switched off — after a rename, or mid-deploy.
    const settings = sanitizeEmailAutomation({
      audienceKinds: { FUTURE_ROLE: { future_kind: false } },
    });
    expect(settings.audienceKinds?.FUTURE_ROLE?.future_kind).toBe(false);
    expect(isAudienceKindAllowed(settings, "FUTURE_ROLE", "future_kind")).toBe(false);
  });

  it("discards non-boolean matrix values instead of coercing them", () => {
    const settings = sanitizeEmailAutomation({
      audienceKinds: { CLEANER: { a: "no", b: 0, c: false } },
    });
    expect(settings.audienceKinds?.CLEANER).toEqual({ c: false });
    // "no" and 0 are not a decision, so they must not block.
    expect(isAudienceKindAllowed(settings, "CLEANER", "a")).toBe(true);
  });

  it("keeps the master switch above everything else", () => {
    const settings = sanitizeEmailAutomation({ masterEnabled: false });
    for (const kind of EMAIL_AUTO_KIND_KEYS) {
      expect(isAutoEmailAllowed(settings, kind)).toBe(false);
    }
  });

  it("enables kinds that did not exist when the settings were saved", () => {
    const settings = sanitizeEmailAutomation({ types: { job_reminder: false } });
    expect(isAutoEmailAllowed(settings, "job_reminder")).toBe(false);
    for (const kind of EMAIL_AUTO_KIND_KEYS.filter((k) => k !== "job_reminder")) {
      expect(isAutoEmailAllowed(settings, kind)).toBe(true);
    }
  });
});
