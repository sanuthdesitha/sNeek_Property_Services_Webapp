/**
 * Plain rules behind the 2026-11-14 draft decisions: what counts as entered
 * onboarding content, when a cleaner draft may be mirrored or saved, and which
 * features a routing save turns to "photos may leave the server".
 */
import { describe, expect, it } from "vitest";
import { describeOnboardingSaveError, hasOnboardingDraftContent, newOnboardingDraftKey, readOnboardingDraftKey } from "@/lib/onboarding/wizard-draft";
import { cleanerDraftFingerprint, mayMirrorCleanerDraft, mayPersistCleanerDraft, recoveredDraftNeedsSync } from "@/lib/cleaner/draft-autosave-gate";
import { DEFAULT_AI_ROUTING, cloudImageFeaturesTurnedOn } from "@/lib/ai/provider/routing-schema";

describe("onboarding first save", () => {
  it("treats an untouched or empty-shell form as nothing to save", () => {
    expect(hasOnboardingDraftContent({})).toBe(false);
    expect(hasOnboardingDraftContent({ propertyName: "  ", isNewClient: false, appliances: [], clientData: { name: "" } })).toBe(false);
    expect(hasOnboardingDraftContent({ clientData: { name: "Harbour View" } })).toBe(true);
    expect(hasOnboardingDraftContent({ bathrooms: 0 })).toBe(true);
    expect(hasOnboardingDraftContent({ isNewClient: true })).toBe(true);
  });
  it("keys are well formed and malformed keys are ignored", () => {
    const key = newOnboardingDraftKey();
    expect(readOnboardingDraftKey(key)).toBe(key);
    expect(readOnboardingDraftKey("short")).toBeNull();
    expect(readOnboardingDraftKey("has spaces in the key value")).toBeNull();
    expect(readOnboardingDraftKey(null)).toBeNull();
  });
  it("shows the first validation issue instead of raw JSON", () => {
    expect(describeOnboardingSaveError(JSON.stringify([{ path: ["clientData", "name"], message: "Required" }]), "x")).toBe("Check clientData.name: Required");
    expect(describeOnboardingSaveError("database unavailable", "x")).toBe("database unavailable");
    expect(describeOnboardingSaveError(undefined, "fallback")).toBe("fallback");
  });
});

describe("cleaner draft gate", () => {
  const base = { hydrated: true, locked: false, submitted: false, needsAcceptance: false, changed: true };
  it("writes nothing without a change, and only mirrors while the job is an offer", () => {
    expect(mayPersistCleanerDraft({ ...base, changed: false })).toBe(false);
    expect(mayMirrorCleanerDraft({ ...base, changed: false })).toBe(false);
    expect(mayMirrorCleanerDraft({ ...base, needsAcceptance: true })).toBe(true);
    expect(mayPersistCleanerDraft({ ...base, needsAcceptance: true })).toBe(false);
    expect(mayPersistCleanerDraft(base)).toBe(true);
    expect(mayPersistCleanerDraft({ ...base, locked: true })).toBe(false);
  });
  it("ignores updatedAt and syncs recovered work only when it differs from the server", () => {
    expect(cleanerDraftFingerprint({ updatedAt: "a", answers: { x: 1 } })).toBe(cleanerDraftFingerprint({ updatedAt: "b", answers: { x: 1 } }));
    expect(recoveredDraftNeedsSync({ updatedAt: "b", answers: { x: 1 } }, { updatedAt: "a", answers: { x: 1 } })).toBe(false);
    expect(recoveredDraftNeedsSync({ answers: { x: 2 } }, { answers: { x: 1 } })).toBe(true);
    expect(recoveredDraftNeedsSync({ answers: {} }, null)).toBe(true);
    expect(recoveredDraftNeedsSync(null, null)).toBe(false);
  });
});

describe("cloud photo switch", () => {
  it("lists only features switched from off to on", () => {
    const on = structuredClone(DEFAULT_AI_ROUTING);
    on.features.photo_compare.allowCloudImages = true;
    expect(cloudImageFeaturesTurnedOn(DEFAULT_AI_ROUTING, on)).toEqual(["photo_compare"]);
    expect(cloudImageFeaturesTurnedOn(on, DEFAULT_AI_ROUTING)).toEqual([]);
    expect(cloudImageFeaturesTurnedOn(on, on)).toEqual([]);
  });
});
