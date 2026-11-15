// @vitest-environment node
/**
 * Your profile (2026-11-16): every change is the signed-in person's own,
 * refused while testing as someone else, audited, and never returns secrets.
 *  - notification switches: own only (no id accepted), SMS needs a mobile;
 *  - signed-in sessions and "Sign out everywhere else" (tier C, in the same
 *    request; an unrecorded current sign-in cannot use it);
 *  - two-step settings: refused while testing, enable/disable audited, the
 *    administrator requirement reported;
 *  - password and passkey removal refused while testing; removal audited.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  session: vi.fn(),
  verify: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  prefFind: vi.fn(),
  prefUpsert: vi.fn(),
  audit: vi.fn(),
  signInFindFirst: vi.fn(),
  signInUpdateMany: vi.fn(),
  signInFindMany: vi.fn(),
  trustedDelete: vi.fn(),
  credentialDelete: vi.fn(),
  verifyTotp: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role, requireSession: m.session }));
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return { ...actual, getAppSettings: m.settings };
});
vi.mock("@/lib/db", () => {
  const tx = {
    userSignIn: { findFirst: m.signInFindFirst, updateMany: m.signInUpdateMany },
    user: { update: m.userUpdate },
    trustedDevice: { deleteMany: m.trustedDelete },
    auditLog: { create: m.audit },
    twoFactorBackupCode: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 10 }) },
  };
  return {
    db: {
      user: { findUnique: m.userFind, update: m.userUpdate },
      userNotificationPreference: { findUnique: m.prefFind, upsert: m.prefUpsert },
      userSignIn: { findMany: m.signInFindMany },
      auditLog: { create: m.audit },
      trustedDevice: { deleteMany: m.trustedDelete },
      webAuthnCredential: { deleteMany: m.credentialDelete },
      $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[])),
    },
  };
});
vi.mock("@/lib/security/admin-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/admin-verification")>();
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/auth/twofactor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/twofactor")>();
  return { ...actual, verifyTotp: m.verifyTotp };
});

import * as notificationRoute from "@/app/api/me/notification-preferences/route";
import * as sessionsRoute from "@/app/api/me/sessions/route";
import * as signOutRoute from "@/app/api/me/sessions/sign-out-others/route";
import * as twoFactorRoute from "@/app/api/auth/2fa/settings/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as passkeyRoute from "@/app/api/auth/webauthn/credentials/[id]/route";

const me = { user: { id: "me", role: "ADMIN", heldRoles: ["ADMIN"], name: "Hannah" }, signInId: "sid-me" };
const testing = { ...me, user: { id: "chloe", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"], name: "Chloe" }, impersonation: { actorId: "me", mode: "FULL", startedAt: 1 } };
const json = (body: unknown, method = "POST") => new NextRequest("http://localhost/x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue(me);
  m.session.mockResolvedValue(me);
  m.prefFind.mockResolvedValue(null);
  m.prefUpsert.mockResolvedValue({});
  m.audit.mockResolvedValue({});
  m.userUpdate.mockResolvedValue({});
  m.trustedDelete.mockResolvedValue({ count: 0 });
  m.settings.mockResolvedValue({ notificationDefaults: { categories: {} }, timezone: "Australia/Sydney" });
});

describe("Notifications to you", () => {
  it("reads and changes only the signed-in person's switches, audited", async () => {
    m.userFind.mockResolvedValue({ phone: "0412555204" });
    const response = await notificationRoute.PATCH(json({ cases: { sms: true } }, "PATCH"));
    expect(response.status).toBe(200);
    expect(m.prefUpsert.mock.calls[0][0].where).toEqual({ userId: "me" });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "me", action: "OWN_NOTIFICATION_PREFERENCES_CHANGED", entityId: "me" });
  });

  it("accepts no other person's id, and SMS needs a mobile number", async () => {
    m.userFind.mockResolvedValue({ phone: null });
    expect((await notificationRoute.PATCH(json({ userId: "someone", jobs: { email: false } }, "PATCH"))).status).toBe(400);
    const sms = await notificationRoute.PATCH(json({ jobs: { sms: true } }, "PATCH"));
    expect(sms.status).toBe(400);
    expect((await sms.json()).error).toBe("Add a mobile number in Details first.");
    expect(m.prefUpsert).not.toHaveBeenCalled();
  });

  it("is refused while testing as someone else, and shows nothing of theirs", async () => {
    m.role.mockResolvedValue(testing);
    expect((await notificationRoute.PATCH(json({ jobs: { email: false } }, "PATCH"))).status).toBe(403);
    expect(await (await notificationRoute.GET()).json()).toEqual({ impersonating: true });
    expect(m.prefUpsert).not.toHaveBeenCalled();
  });
});

describe("Signed-in sessions", () => {
  it("lists the caller's own recorded sign-ins and marks this browser", async () => {
    m.signInFindMany.mockResolvedValue([
      { id: "sid-me", method: "PASSWORD", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130.0", createdAt: new Date("2026-11-16T07:58:00Z"), lastActiveAt: new Date() },
      { id: "sid-old", method: "PASSKEY", userAgent: null, createdAt: new Date("2026-11-16T01:00:00Z"), lastActiveAt: new Date() },
    ]);
    m.userFind.mockResolvedValue({ sessionsValidFrom: null });
    const body = await (await sessionsRoute.GET()).json();
    expect(m.signInFindMany.mock.calls[0][0].where).toMatchObject({ userId: "me", revokedAt: null });
    expect(body.sessions[0]).toMatchObject({ id: "sid-me", current: true, device: "Chrome on macOS" });
    expect(body.sessions[1]).toMatchObject({ id: "sid-old", current: false, device: null, method: "PASSKEY" });
    expect(body.currentUnrecorded).toBe(false);
  });

  it("Sign out everywhere else needs the person's own credential in the same request", async () => {
    m.verify.mockRejectedValue(Object.assign(new Error("PIN_OR_PASSWORD_REQUIRED"), {}));
    const refused = await signOutRoute.POST(json({}));
    expect(refused.status).toBe(423);
    expect(m.signInUpdateMany).not.toHaveBeenCalled();
  });

  it("revokes every other sign-in, refuses older unrecorded tokens from now and keeps this browser", async () => {
    m.verify.mockResolvedValue("pin");
    m.signInFindFirst.mockResolvedValue({ id: "sid-me" });
    m.signInUpdateMany.mockResolvedValue({ count: 2 });
    const response = await signOutRoute.POST(json({ security: { pin: "1234" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: 2 });
    expect(m.verify).toHaveBeenCalledWith("me", { pin: "1234" });
    expect(m.signInUpdateMany.mock.calls[0][0].where).toEqual({ userId: "me", revokedAt: null, id: { not: "sid-me" } });
    expect(m.userUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "me" }, data: { sessionsValidFrom: expect.any(Date) } });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "me", action: "SESSIONS_SIGNED_OUT_ELSEWHERE" });
  });

  it("cannot sign out elsewhere from an unrecorded sign-in, or while testing as someone else", async () => {
    m.verify.mockResolvedValue("pin");
    m.role.mockResolvedValue({ ...me, signInId: null });
    expect((await signOutRoute.POST(json({ security: { pin: "1234" } }))).status).toBe(409);
    m.role.mockResolvedValue(testing);
    expect((await signOutRoute.POST(json({ security: { pin: "1234" } }))).status).toBe(403);
    expect(m.signInUpdateMany).not.toHaveBeenCalled();
  });
});

describe("Two-step sign-in settings", () => {
  it("reports the administrator requirement and never returns a secret", async () => {
    m.userFind.mockResolvedValue({ twoFactorEnabled: false, twoFactorMethod: null, twoFactorBackupCodes: null, passwordHash: "hash", email: "a@x", twoStepRequiredSince: new Date(Date.now() - 86_400_000) });
    const body = await (await twoFactorRoute.GET()).json();
    expect(body.requirement.kind).toBe("grace");
    expect(body).not.toHaveProperty("passwordHash");
    expect(body).not.toHaveProperty("totpSecret");
    expect(body.hasPassword).toBe(true);
  });

  it("is refused while testing as someone else", async () => {
    m.session.mockResolvedValue(testing);
    for (const call of [() => twoFactorRoute.POST(json({ method: "TOTP" })), () => twoFactorRoute.PUT(json({ method: "TOTP", code: "123456" }, "PUT")), () => twoFactorRoute.DELETE(json({ password: "x" }, "DELETE"))]) {
      expect((await call()).status).toBe(403);
    }
    expect(m.userUpdate).not.toHaveBeenCalled();
  });

  it("audits turning it on", async () => {
    m.userFind.mockResolvedValue({ email: "a@x", totpSecret: "SECRET" });
    m.verifyTotp.mockReturnValue(true);
    const response = await twoFactorRoute.PUT(json({ method: "TOTP", code: "123456" }, "PUT"));
    expect(response.status).toBe(200);
    expect(m.audit.mock.calls.map((call) => call[0].data.action)).toContain("OWN_TWO_FACTOR_ENABLED");
    // A new set of backup codes comes with it, shown once; the audit never holds a code.
    const body = await response.json();
    expect(body.backupCodes).toHaveLength(10);
    expect(m.audit.mock.calls.map((call) => call[0].data.action)).toContain("TWO_FACTOR_BACKUP_CODES_CREATED");
    const audited = JSON.stringify(m.audit.mock.calls);
    for (const code of body.backupCodes as string[]) expect(audited).not.toContain(code);
  });
});

describe("Password and passkeys", () => {
  it("are refused while testing as someone else", async () => {
    m.session.mockResolvedValue(testing);
    expect((await passwordRoute.POST(json({ currentPassword: "a", newPassword: "abcdefgh" }))).status).toBe(403);
    expect((await passkeyRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: { id: "pk" } })).status).toBe(403);
    expect(m.credentialDelete).not.toHaveBeenCalled();
  });

  it("removes only the caller's own passkey and audits it", async () => {
    m.credentialDelete.mockResolvedValue({ count: 1 });
    expect((await passkeyRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: { id: "pk" } })).status).toBe(200);
    expect(m.credentialDelete.mock.calls[0][0].where).toEqual({ id: "pk", userId: "me" });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "me", action: "OWN_PASSKEY_REMOVED", entityId: "pk" });
  });
});
