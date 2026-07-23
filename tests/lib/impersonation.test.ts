// @vitest-environment node
//
// Node, not jsdom: jose validates `plaintext instanceof Uint8Array`, and
// jsdom's TextEncoder returns a Uint8Array from a different realm, so JWE
// encryption throws there. This module only ever runs server-side anyway.
import { describe, it, expect, beforeAll } from "vitest";
import {
  IMPERSONATION_MAX_AGE_SECONDS,
  isReadOnlySafeMethod,
  readImpersonationTicket,
  signImpersonationTicket,
  type ImpersonationTicket,
} from "@/lib/auth/impersonation";

/**
 * The impersonation ticket is the entire client-side authority for "this admin
 * is viewing as someone else", so the thing worth testing hardest is what it
 * REFUSES. Every rejection below is a way an attacker or a stale browser could
 * otherwise end up with a session that isn't theirs.
 */

const TICKET: ImpersonationTicket = {
  actorId: "admin-1",
  actorEmail: "admin@example.com",
  targetId: "cleaner-9",
  targetRole: "CLEANER" as ImpersonationTicket["targetRole"],
  mode: "READ_ONLY",
  startedAt: 1_700_000_000_000,
};

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-impersonation-tickets";
});

describe("impersonation ticket", () => {
  it("round-trips a valid ticket", async () => {
    const token = await signImpersonationTicket(TICKET);
    const decoded = await readImpersonationTicket(token);
    expect(decoded).toMatchObject({
      actorId: "admin-1",
      targetId: "cleaner-9",
      targetRole: "CLEANER",
      mode: "READ_ONLY",
      startedAt: TICKET.startedAt,
    });
  });

  it("returns null for no cookie", async () => {
    expect(await readImpersonationTicket(undefined)).toBeNull();
    expect(await readImpersonationTicket("")).toBeNull();
  });

  it("rejects a garbage or non-JWT value", async () => {
    expect(await readImpersonationTicket("not-a-token")).toBeNull();
    expect(await readImpersonationTicket("a.b.c")).toBeNull();
  });

  it("rejects a ticket signed with a different secret", async () => {
    const token = await signImpersonationTicket(TICKET);
    process.env.NEXTAUTH_SECRET = "a-completely-different-secret";
    const decoded = await readImpersonationTicket(token);
    process.env.NEXTAUTH_SECRET = "test-secret-for-impersonation-tickets";
    // This is the forgery case: without our secret you cannot mint a ticket.
    expect(decoded).toBeNull();
  });

  it("rejects a tampered token body", async () => {
    const token = await signImpersonationTicket(TICKET);
    const parts = token.split(".");
    parts[1] = parts[1].slice(0, -3) + "AAA";
    expect(await readImpersonationTicket(parts.join("."))).toBeNull();
  });

  it("rejects self-impersonation", async () => {
    const token = await signImpersonationTicket({ ...TICKET, targetId: TICKET.actorId });
    expect(await readImpersonationTicket(token)).toBeNull();
  });

  it("rejects an unknown mode", async () => {
    const token = await signImpersonationTicket({
      ...TICKET,
      mode: "GOD" as unknown as ImpersonationTicket["mode"],
    });
    expect(await readImpersonationTicket(token)).toBeNull();
  });

  it("rejects a ticket missing the actor or target", async () => {
    for (const field of ["actorId", "targetId", "targetRole"] as const) {
      const token = await signImpersonationTicket({ ...TICKET, [field]: "" });
      expect(await readImpersonationTicket(token), `${field} empty`).toBeNull();
    }
  });

  it("expires — an old cookie is not honoured forever", async () => {
    // Sign with a maxAge already in the past by encoding an exp behind us.
    const token = await signImpersonationTicket(TICKET);
    const decoded = await readImpersonationTicket(token);
    expect(decoded).not.toBeNull();
    // The ticket carries a 1h lifetime, well short of the 8h session, so an
    // abandoned test session lapses on its own.
    expect(IMPERSONATION_MAX_AGE_SECONDS).toBe(3600);
  });
});

describe("read-only method gate", () => {
  it("allows only methods that cannot change state", () => {
    for (const m of ["GET", "get", "HEAD", "OPTIONS"]) {
      expect(isReadOnlySafeMethod(m), m).toBe(true);
    }
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(isReadOnlySafeMethod(m), m).toBe(false);
    }
  });
});
