import { describe, it, expect } from "vitest";
import {
  TEST_AS_UNLOCK_MAX_ATTEMPTS,
  TEST_AS_UNLOCK_MINUTES,
  TEST_AS_UNLOCK_WINDOW_MS,
  isTestAsUnlocked,
  parseTestAsUnlockToken,
  signTestAsUnlock,
  testAsUnlockCookieOptions,
  testAsUnlockRateKey,
} from "@/lib/auth/test-as-unlock";
import { rateLimit } from "@/lib/security/rate-limit";

const NOW = Date.UTC(2026, 6, 26, 1, 0, 0); // 2026-07-26T01:00:00Z
const MINUTE = 60 * 1000;
const USER = "clh0admin000000000000000";

describe("signTestAsUnlock / parseTestAsUnlockToken", () => {
  it("round-trips the user id and a 15-minute expiry", () => {
    const parsed = parseTestAsUnlockToken(signTestAsUnlock(USER, NOW));
    expect(parsed).toEqual({ userId: USER, expiresAt: NOW + TEST_AS_UNLOCK_MINUTES * MINUTE });
  });

  it("rejects a tampered payload, a tampered signature and junk", () => {
    const token = signTestAsUnlock(USER, NOW);
    const [userId, exp, sig] = token.split(".");

    // Someone else's id, keeping our signature.
    expect(parseTestAsUnlockToken(`someone-else.${exp}.${sig}`)).toBeNull();
    // Pushing the expiry out.
    expect(parseTestAsUnlockToken(`${userId}.${Number(exp) + 60 * MINUTE}.${sig}`)).toBeNull();
    // Flipped signature.
    expect(parseTestAsUnlockToken(`${userId}.${exp}.${"0".repeat(sig.length)}`)).toBeNull();
    // Shape.
    expect(parseTestAsUnlockToken("")).toBeNull();
    expect(parseTestAsUnlockToken(undefined)).toBeNull();
    expect(parseTestAsUnlockToken("not-a-token")).toBeNull();
    expect(parseTestAsUnlockToken(`${userId}.${exp}.${sig}.extra`)).toBeNull();
  });
});

describe("isTestAsUnlocked", () => {
  const token = signTestAsUnlock(USER, NOW);

  it("holds for the issuing admin right up to the expiry", () => {
    expect(isTestAsUnlocked(token, USER, NOW)).toBe(true);
    expect(isTestAsUnlocked(token, USER, NOW + 14 * MINUTE)).toBe(true);
  });

  it("expires at exactly 15 minutes", () => {
    expect(isTestAsUnlocked(token, USER, NOW + TEST_AS_UNLOCK_MINUTES * MINUTE)).toBe(false);
    expect(isTestAsUnlocked(token, USER, NOW + 16 * MINUTE)).toBe(false);
  });

  it("is useless in another admin's session (a leaked cookie proves nothing)", () => {
    expect(isTestAsUnlocked(token, "another-admin", NOW)).toBe(false);
  });

  it("is false for a missing cookie", () => {
    expect(isTestAsUnlocked(undefined, USER, NOW)).toBe(false);
    expect(isTestAsUnlocked(null, USER, NOW)).toBe(false);
  });
});

describe("unlock rate limiting", () => {
  it("scopes the bucket to one admin", () => {
    expect(testAsUnlockRateKey("a")).not.toBe(testAsUnlockRateKey("b"));
    expect(testAsUnlockRateKey(USER)).toContain(USER);
  });

  it("allows 5 attempts then blocks with a retry-after inside the window", () => {
    const key = testAsUnlockRateKey(`unit-${Math.random()}`);
    const opts = { limit: TEST_AS_UNLOCK_MAX_ATTEMPTS, windowMs: TEST_AS_UNLOCK_WINDOW_MS };
    for (let i = 0; i < TEST_AS_UNLOCK_MAX_ATTEMPTS; i++) {
      expect(rateLimit(key, opts).ok).toBe(true);
    }
    const blocked = rateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(TEST_AS_UNLOCK_WINDOW_MS / 1000);
  });
});

describe("testAsUnlockCookieOptions", () => {
  it("is httpOnly, lax and scoped to the unlock lifetime", () => {
    expect(testAsUnlockCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: TEST_AS_UNLOCK_MINUTES * 60,
    });
  });

  it("supports an immediate clear", () => {
    expect(testAsUnlockCookieOptions(0).maxAge).toBe(0);
  });
});
