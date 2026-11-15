// @vitest-environment node
/**
 * The short-lived "two-step passed" proof cookie must verify for real
 * addresses, which contain dots (2026-11-17 fix: splitting the value on every
 * dot refused every address, so a correct second step still failed sign-in).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
process.env.NEXTAUTH_SECRET ??= "proof-cookie-fixture-key";

import { signTwoFaOk, verifyTwoFaOk } from "@/lib/auth/twofactor";

describe("two-step proof cookie", () => {
  it("verifies for an address with dots in the name and the domain", () => {
    const email = "first.last@sneek.example.com.au";
    expect(verifyTwoFaOk(signTwoFaOk(email), email)).toBe(true);
    expect(verifyTwoFaOk(signTwoFaOk(email.toUpperCase()), email)).toBe(true);
  });

  it("refuses another address, a changed expiry, a bad signature, an expired proof and junk", () => {
    const email = "a@x.example";
    const value = signTwoFaOk(email);
    expect(verifyTwoFaOk(value, "b@x.example")).toBe(false);
    const [, sig] = [value.slice(0, value.lastIndexOf(".")), value.slice(value.lastIndexOf(".") + 1)];
    expect(verifyTwoFaOk(`${email}.${Date.now() + 99_999_999}.${sig}`, email)).toBe(false);
    expect(verifyTwoFaOk(`${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`, email)).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(verifyTwoFaOk(value, email)).toBe(false);
    vi.useRealTimers();
    for (const junk of ["", "nodots", ".1.2", "a@x.example..sig", undefined]) expect(verifyTwoFaOk(junk, email)).toBe(false);
  });
});
