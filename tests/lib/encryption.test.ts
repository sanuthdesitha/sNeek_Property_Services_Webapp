import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/security/encryption";

/**
 * Cover for the plaintext-secrets incident: ENCRYPTION_KEY had never been set
 * in any environment, so getKey() returned null and encryptSecret() silently
 * returned the PLAINTEXT it was handed. Property.accessCode and
 * Property.alarmCode were written unencrypted while every call site read as
 * though it were encrypting.
 *
 * The write path now refuses without a key and the read path stays tolerant of
 * the rows written during that period. Both halves of that asymmetry are
 * asserted here — the write half is what stops a repeat, the read half is what
 * keeps cleaners able to open doors before the backfill has run.
 */

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const KEY = "test-key-not-a-real-secret";

function withKey(value: string | undefined) {
  if (value === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = value;
}

afterEach(() => {
  withKey(ORIGINAL_KEY);
});

describe("encryptSecret", () => {
  it("refuses to write rather than storing plaintext when no key is configured", () => {
    withKey(undefined);
    expect(() => encryptSecret("1234#")).toThrow(/ENCRYPTION_KEY/);
  });

  it("also refuses when the key is only whitespace", () => {
    withKey("   ");
    expect(() => encryptSecret("1234#")).toThrow(/ENCRYPTION_KEY/);
  });

  it("returns null for an absent secret without needing a key", () => {
    withKey(undefined);
    // Nothing to protect, so a missing key is not an error on this path —
    // a property saved with no door code must not 500.
    expect(encryptSecret("")).toBeNull();
    expect(encryptSecret("   ")).toBeNull();
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret(undefined)).toBeNull();
  });

  it("produces a prefixed enc:v1 payload", () => {
    withKey(KEY);
    const result = encryptSecret("1234#");
    expect(result).toMatch(/^enc:v1:[0-9a-f]{32}:[0-9a-f]+$/);
  });

  it("uses a fresh IV, so the same code does not encrypt to the same ciphertext", () => {
    withKey(KEY);
    expect(encryptSecret("1234#")).not.toBe(encryptSecret("1234#"));
  });

  it("trims before encrypting", () => {
    withKey(KEY);
    expect(decryptSecret(encryptSecret(" 1234# "))).toBe("1234#");
  });
});

describe("decryptSecret", () => {
  it("round-trips a value encrypted with the same key", () => {
    withKey(KEY);
    expect(decryptSecret(encryptSecret("1234#"))).toBe("1234#");
  });

  it("passes legacy plaintext through untouched", () => {
    withKey(KEY);
    // The rows written while the key was unset are bare codes, not ciphertext.
    expect(decryptSecret("1234#")).toBe("1234#");
  });

  it("passes a value through unchanged when no key is configured", () => {
    withKey(undefined);
    expect(decryptSecret("1234#")).toBe("1234#");
    expect(decryptSecret("enc:v1:abc:def")).toBe("enc:v1:abc:def");
  });

  it("returns null for an absent value", () => {
    withKey(KEY);
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });

  it("returns null on a malformed payload rather than throwing", () => {
    withKey(KEY);
    expect(decryptSecret("enc:v1:")).toBeNull();
    expect(decryptSecret("enc:v1:onlyonepart")).toBeNull();
    expect(decryptSecret("enc:v1:nothex:alsonothex")).toBeNull();
  });

  it("never returns the original secret when decrypted with the wrong key", () => {
    withKey(KEY);
    const encrypted = encryptSecret("1234#");
    withKey("a-different-key");
    const result = decryptSecret(encrypted);
    // Padding validation rejects almost every wrong key, giving null; assert
    // the property that actually matters rather than the usual outcome.
    expect(result === null || result !== "1234#").toBe(true);
  });
});

describe("isEncrypted", () => {
  it("recognises the current format", () => {
    withKey(KEY);
    expect(isEncrypted(encryptSecret("1234#"))).toBe(true);
  });

  it("rejects legacy plaintext and empty values", () => {
    expect(isEncrypted("1234#")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted(null)).toBeFalsy();
    expect(isEncrypted(undefined)).toBeFalsy();
  });
});
