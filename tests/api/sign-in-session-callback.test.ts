// @vitest-environment node
/**
 * Recorded sign-ins in the NextAuth callbacks: a new sign-in records the
 * browser's user agent and puts the record's id in the token; a revoked
 * sign-in, or an unrecorded token older than "Sign out everywhere else",
 * reads as signed out (null session) on every server read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({ db: { userSignIn: { create: m.create, update: m.update }, user: { findUnique: m.find } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));

import { createAuthOptions } from "@/lib/auth/auth-options";

const callbacks = createAuthOptions("http://localhost:3161").callbacks!;
const baseSession = { user: { id: "", role: "ADMIN" }, expires: "2026-12-01T00:00:00.000Z" } as never;

beforeEach(() => {
  vi.resetAllMocks();
  m.create.mockResolvedValue({ id: "sid-1" });
  m.update.mockResolvedValue({});
});

describe("sign-in records", () => {
  it("records a new password sign-in with its user agent and carries the id in the token", async () => {
    const token = await callbacks.jwt!({ token: {}, user: { id: "u", role: "ADMIN", signInMethod: "PASSWORD", signInUserAgent: "Chrome/130" } as never } as never);
    expect(m.create.mock.calls[0][0].data).toEqual({ userId: "u", method: "PASSWORD", userAgent: "Chrome/130" });
    expect(token).toMatchObject({ id: "u", sid: "sid-1" });
  });

  it("a revoked sign-in reads as signed out; a live one keeps its session", async () => {
    m.find.mockResolvedValue({ sessionsValidFrom: null, signIns: [{ id: "sid-1", userId: "u", revokedAt: new Date(), lastActiveAt: new Date() }] });
    expect(await callbacks.session!({ session: baseSession, token: { id: "u", role: "ADMIN", sid: "sid-1", iat: 1 } } as never)).toBeNull();
    m.find.mockResolvedValue({ sessionsValidFrom: new Date(), signIns: [{ id: "sid-1", userId: "u", revokedAt: null, lastActiveAt: new Date() }] });
    const session = await callbacks.session!({ session: baseSession, token: { id: "u", role: "ADMIN", sid: "sid-1", iat: 1 } } as never);
    expect(session).toMatchObject({ user: { id: "u" }, signInId: "sid-1" });
  });

  it("an older unrecorded token is refused after sign-out everywhere else", async () => {
    m.find.mockResolvedValue({ sessionsValidFrom: new Date("2026-11-16T10:00:00Z"), signIns: false });
    const iat = Math.floor(Date.parse("2026-11-16T09:00:00Z") / 1000);
    expect(await callbacks.session!({ session: baseSession, token: { id: "u", role: "ADMIN", iat } } as never)).toBeNull();
  });
});
