// @vitest-environment node
/**
 * Your profile security rules (2026-11-16): the two-step requirement with a
 * grace path (never a lock-out), the recorded sign-in token rule behind
 * "Sign out everywhere else", and the device label (never a guess).
 */
import { describe, expect, it } from "vitest";
import { TWO_STEP_GRACE_DAYS, isAdminPortalPage, pageExemptFromTwoStep, twoStepRequirement } from "@/lib/auth/two-step-policy";
import { tokenRefusalFor } from "@/lib/auth/sign-in-records";
import { describeUserAgent } from "@/lib/auth/user-agent-label";

const NOW = new Date("2026-11-16T00:00:00Z");
const DAY = 86_400_000;

describe("two-step requirement", () => {
  it("is required for administrators with a grace period, suggested for operations managers", () => {
    expect(twoStepRequirement({ holdsAdmin: true, holdsOpsManager: false, twoFactorEnabled: false, requiredSince: null }, NOW)).toEqual({ kind: "grace", deadline: null });
    const since = new Date(NOW.getTime() - 3 * DAY);
    expect(twoStepRequirement({ holdsAdmin: true, holdsOpsManager: false, twoFactorEnabled: false, requiredSince: since }, NOW)).toEqual({ kind: "grace", deadline: new Date(since.getTime() + TWO_STEP_GRACE_DAYS * DAY) });
    expect(twoStepRequirement({ holdsAdmin: true, holdsOpsManager: false, twoFactorEnabled: false, requiredSince: new Date(NOW.getTime() - 15 * DAY) }, NOW).kind).toBe("setup_required");
    expect(twoStepRequirement({ holdsAdmin: true, holdsOpsManager: false, twoFactorEnabled: true, requiredSince: null }, NOW)).toEqual({ kind: "met", required: true });
    expect(twoStepRequirement({ holdsAdmin: false, holdsOpsManager: true, twoFactorEnabled: false, requiredSince: new Date(0) }, NOW)).toEqual({ kind: "suggested" });
    expect(twoStepRequirement({ holdsAdmin: false, holdsOpsManager: false, twoFactorEnabled: false, requiredSince: null }, NOW)).toEqual({ kind: "not_applicable" });
  });

  it("never redirects away from Your profile, and only admin portal pages are affected", () => {
    expect(pageExemptFromTwoStep("/v2/admin/profile")).toBe(true);
    expect(pageExemptFromTwoStep("/v2/admin/profile?setup=two-step")).toBe(true);
    expect(pageExemptFromTwoStep("/v2/admin/profiles-bad")).toBe(false);
    expect(pageExemptFromTwoStep("/v2/admin/jobs")).toBe(false);
    expect(isAdminPortalPage("/v2/admin")).toBe(true);
    expect(isAdminPortalPage("/api/auth/2fa/settings")).toBe(false);
    expect(isAdminPortalPage("/v2/cleaner")).toBe(false);
    expect(isAdminPortalPage(null)).toBe(false);
  });
});

describe("recorded sign-in token rule", () => {
  const validFrom = new Date("2026-11-16T10:00:00Z");
  it("a revoked sign-in is refused; a live one passes even after sign-out elsewhere", () => {
    expect(tokenRefusalFor({ userId: "u", sid: "s1", issuedAtSeconds: 1 }, { userId: "u", revokedAt: new Date() }, null)).toBe("REVOKED");
    expect(tokenRefusalFor({ userId: "u", sid: "s1", issuedAtSeconds: 1 }, { userId: "u", revokedAt: null }, validFrom)).toBeNull();
  });
  it("an unrecorded older token is refused once the person signed out everywhere else, never before", () => {
    const before = Math.floor(validFrom.getTime() / 1000) - 60;
    const after = Math.floor(validFrom.getTime() / 1000) + 60;
    expect(tokenRefusalFor({ userId: "u", sid: null, issuedAtSeconds: before }, null, null)).toBeNull();
    expect(tokenRefusalFor({ userId: "u", sid: null, issuedAtSeconds: before }, null, validFrom)).toBe("SIGNED_OUT_EVERYWHERE");
    expect(tokenRefusalFor({ userId: "u", sid: null, issuedAtSeconds: after }, null, validFrom)).toBeNull();
    // Another person's sign-in id never vouches for this token.
    expect(tokenRefusalFor({ userId: "u", sid: "theirs", issuedAtSeconds: before }, { userId: "someone", revokedAt: null }, validFrom)).toBe("SIGNED_OUT_EVERYWHERE");
  });
});

describe("device label", () => {
  it("describes what the browser said and nothing more", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toEqual({ label: "Chrome on macOS", kind: "desktop" });
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toEqual({ label: "Safari on iPhone", kind: "phone" });
    expect(describeUserAgent(null)).toEqual({ label: null, kind: "unknown" });
    expect(describeUserAgent("curl/8.0")).toEqual({ label: null, kind: "unknown" });
  });
});
