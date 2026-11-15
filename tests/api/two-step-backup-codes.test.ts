// @vitest-environment node
/**
 * Two-step backup codes (2026-11-17), with mocked storage:
 *  - the code shape (ten unambiguous characters, two groups of five);
 *  - "Make new backup codes": refused while testing as someone else, needs the
 *    person's own credential, needs two-step on, returns the codes once with
 *    no-store, audits without any code;
 *  - sign-in with a backup code: the remaining count (never the code), the
 *    notice once with explicit transports, wrong codes on the shared two-step
 *    lockout counter, failures audited without the code;
 *  - turning two-step off and an administrator's reset delete the codes.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  role: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  audit: vi.fn(),
  trustedDelete: vi.fn(),
  codeDelete: vi.fn(),
  codeCreate: vi.fn(),
  codeFindFirst: vi.fn(),
  codeUpdateMany: vi.fn(),
  codeCount: vi.fn(),
  codeFindMany: vi.fn(),
  verify: vi.fn(),
  bcrypt: vi.fn(),
  lockout: vi.fn(),
  recordFailed: vi.fn(),
  clearFailed: vi.fn(),
  verifyTotp: vi.fn(),
  notice: vi.fn(),
  office: vi.fn(),
  delegated: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session, requireRole: m.role }));
vi.mock("bcryptjs", () => ({ default: { compare: m.bcrypt, hash: vi.fn() }, compare: m.bcrypt }));
vi.mock("@/lib/db", () => {
  const tx = {
    user: { update: m.userUpdate },
    trustedDevice: { deleteMany: m.trustedDelete },
    auditLog: { create: m.audit },
    twoFactorBackupCode: { deleteMany: m.codeDelete, createMany: m.codeCreate },
  };
  return {
    db: {
      user: { findUnique: m.userFind, update: m.userUpdate },
      auditLog: { create: m.audit },
      trustedDevice: { deleteMany: m.trustedDelete },
      twoFactorBackupCode: { findFirst: m.codeFindFirst, updateMany: m.codeUpdateMany, count: m.codeCount, findMany: m.codeFindMany, deleteMany: m.codeDelete, createMany: m.codeCreate },
      $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[])),
    },
  };
});
vi.mock("@/lib/security/admin-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/admin-verification")>();
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/auth/login-lockout", () => ({
  twoFaKey: (email: string) => `2fa:${email}`,
  ensureNotLockedOut: m.lockout,
  recordFailedAttempt: m.recordFailed,
  clearFailedAttempts: m.clearFailed,
}));
vi.mock("@/lib/auth/twofactor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/twofactor")>();
  return { ...actual, verifyTotp: m.verifyTotp, verifyEmailTwoFaCode: vi.fn(async () => false), createTrustedDevice: vi.fn() };
});
vi.mock("@/lib/auth/backup-code-notice", () => ({ sendBackupCodeUsedNotice: m.notice }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: vi.fn(async () => ({ disabledTransports: {} })) }));
vi.mock("@/lib/rbac/delegated-admin", () => ({
  DelegatedActionDenied: class extends Error { status = 403; },
  requireDelegatedAction: m.delegated,
}));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return { ...actual, getAppSettings: vi.fn(async () => ({ ...actual.getDefaultSettings?.(), timezone: "Australia/Sydney", companyName: "sNeek" })) };
});

import * as format from "@/lib/auth/backup-code-format";
import { hashBackupCode } from "@/lib/auth/backup-codes";
import * as backupRoute from "@/app/api/auth/2fa/backup-codes/route";
import * as settingsRoute from "@/app/api/auth/2fa/settings/route";
import * as completeRoute from "@/app/api/auth/2fa/complete/route";
import * as resetRoute from "@/app/api/admin/users/[id]/disable-2fa/route";

const me = { user: { id: "me", role: "ADMIN", heldRoles: ["ADMIN"], name: "Me", email: "me@x.invalid" } };
const testing = { ...me, impersonation: { actorId: "me", targetId: "other" } };

function json(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/test", { method, body: JSON.stringify(body), headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue(me);
  m.role.mockResolvedValue(me);
  m.codeDelete.mockResolvedValue({ count: 4 });
  m.codeCreate.mockResolvedValue({ count: 10 });
  m.lockout.mockResolvedValue({ ok: true });
  m.notice.mockResolvedValue([]);
  m.delegated.mockResolvedValue({ role: "ADMIN" });
  m.verify.mockResolvedValue(true);
});

describe("backup code shape", () => {
  it("makes ten distinct codes of two groups of five unambiguous characters", () => {
    let seed = 7;
    const random = (max: number) => (seed = (seed * 48271) % 2147483647) % max;
    const codes = format.generateBackupCodeSet(random);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    expect(format.BACKUP_CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it("is forgiving about case, spaces and dashes, and never mistakes a 6-digit code for one", () => {
    expect(format.normalizeBackupCodeInput(" abcde fghjk ")).toBe("ABCDEFGHJK");
    expect(format.looksLikeBackupCode("abcde-fghjk")).toBe(true);
    expect(format.looksLikeBackupCode("123456")).toBe(false);
    expect(hashBackupCode("u1", "abcde-fghjk")).toBe(hashBackupCode("u1", "ABCDEFGHJK"));
    expect(hashBackupCode("u1", "ABCDEFGHJK")).not.toBe(hashBackupCode("u2", "ABCDEFGHJK"));
  });

  it("writes the download as plain text with the once-only warning", () => {
    const text = format.backupCodesText({ codes: ["ABCDE-FGHJK"], accountEmail: "a@x.invalid", createdLabel: "Tue 17 Nov 2026" });
    expect(text).toContain("Each code works once");
    expect(text).toContain(" 1. ABCDE-FGHJK");
    expect(text).not.toMatch(/</);
  });
});

describe("Make new backup codes", () => {
  it("is refused while testing as someone else, and nothing is made", async () => {
    m.session.mockResolvedValue(testing);
    const response = await backupRoute.POST(json({ security: { pin: "1234" } }));
    expect(response.status).toBe(403);
    expect(m.codeCreate).not.toHaveBeenCalled();
    expect(m.verify).not.toHaveBeenCalled();
  });

  it("needs two-step on", async () => {
    m.userFind.mockResolvedValue({ twoFactorEnabled: false });
    expect((await backupRoute.POST(json({ security: { pin: "1234" } }))).status).toBe(409);
    expect(m.codeCreate).not.toHaveBeenCalled();
  });

  it("needs the person's own credential; a refused one makes nothing and the old codes stay", async () => {
    m.userFind.mockResolvedValue({ twoFactorEnabled: true });
    const { SensitiveVerificationError } = await import("@/lib/security/admin-verification");
    m.verify.mockRejectedValue(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    const response = await backupRoute.POST(json({ security: { pin: "0000" } }));
    expect(response.status).toBe(423);
    expect(m.verify).toHaveBeenCalledWith("me", { pin: "0000" });
    expect(m.codeDelete).not.toHaveBeenCalled();
    expect(m.codeCreate).not.toHaveBeenCalled();
  });

  it("replaces every older code, returns ten once with no-store, and audits without a code", async () => {
    m.userFind.mockResolvedValue({ twoFactorEnabled: true });
    const response = await backupRoute.POST(json({ security: { pin: "1234" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.codes).toHaveLength(10);
    expect(m.codeDelete).toHaveBeenCalledWith({ where: { userId: "me" } });
    const stored = m.codeCreate.mock.calls[0][0].data as Array<{ codeHash: string; userId: string }>;
    expect(stored).toHaveLength(10);
    const storedText = JSON.stringify(stored);
    for (const code of body.codes as string[]) {
      expect(storedText).not.toContain(code);
      expect(storedText).not.toContain(format.normalizeBackupCodeInput(code));
    }
    expect(stored.map((row) => row.codeHash)).toEqual((body.codes as string[]).map((code) => hashBackupCode("me", code)));
    const audit = m.audit.mock.calls.find((call) => call[0].data.action === "TWO_FACTOR_BACKUP_CODES_CREATED")![0].data;
    expect(audit).toMatchObject({ userId: "me", after: { reason: "made_new_set", count: 10, replaced: 4 } });
    for (const code of body.codes as string[]) expect(JSON.stringify(m.audit.mock.calls)).not.toContain(code);
  });

  it("asks other accounts for their password instead of a PIN", async () => {
    m.session.mockResolvedValue({ user: { id: "cl", role: "CLEANER", heldRoles: ["CLEANER"] } });
    m.userFind.mockResolvedValueOnce({ twoFactorEnabled: true }).mockResolvedValueOnce({ passwordHash: "hash" });
    m.bcrypt.mockResolvedValue(false);
    expect((await backupRoute.POST(json({ security: { password: "wrong" } }))).status).toBe(423);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.codeCreate).not.toHaveBeenCalled();
  });

  it("status never includes a code or a hash", async () => {
    m.userFind.mockResolvedValue({ twoFactorEnabled: true });
    m.codeFindMany.mockResolvedValue([{ createdAt: new Date("2026-11-17T00:00:00Z"), usedAt: null, hashScheme: "hmac-sha256-v1" }, { createdAt: new Date("2026-11-17T00:00:00Z"), usedAt: new Date(), hashScheme: "hmac-sha256-v1" }]);
    const body = await (await backupRoute.GET()).json();
    expect(body).toEqual({ enabled: true, total: 2, remaining: 1, createdAt: "2026-11-17T00:00:00.000Z", olderSet: false });
  });
});

describe("sign-in with a backup code", () => {
  const user = { id: "u1", email: "a@x.invalid", name: "Alex", role: "ADMIN", isActive: true, passwordHash: "hash", twoFactorEnabled: true, twoFactorMethod: "TOTP", totpSecret: "S" };
  const attempt = (code: string, method?: string) => completeRoute.POST(json({ email: "a@x.invalid", password: "pw", code, ...(method ? { method } : {}) }));

  beforeEach(() => {
    m.userFind.mockResolvedValue(user);
    m.bcrypt.mockResolvedValue(true);
  });

  it("signs in, says how many remain and prompts at three or fewer, without echoing the code", async () => {
    m.codeFindFirst.mockResolvedValue({ id: "code-1", setId: "set-1" });
    m.codeUpdateMany.mockResolvedValue({ count: 1 });
    m.codeCount.mockResolvedValue(3);
    const response = await attempt("abcde-fghjk", "backup");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/ABCDE|abcde/);
    expect(JSON.parse(text).backupCode).toEqual({ remaining: 3, makeNewSuggested: true, newCodesPath: "/v2/admin/profile?setup=two-step", settingsPath: "/v2/admin/profile?setup=two-step" });
    expect(m.codeUpdateMany).toHaveBeenCalledWith({ where: { id: "code-1", userId: "u1", usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(m.verifyTotp).not.toHaveBeenCalled();
    expect(m.clearFailed).toHaveBeenCalledWith("2fa:a@x.invalid");
    expect(m.notice).toHaveBeenCalledTimes(1);
    expect(m.notice.mock.calls[0][0]).toMatchObject({ codeId: "code-1", remaining: 3, user: { id: "u1" } });
    expect(JSON.stringify(m.notice.mock.calls)).not.toMatch(/ABCDE|abcde/);
    const used = m.audit.mock.calls.find((call) => call[0].data.action === "TWO_FACTOR_BACKUP_CODE_USED")![0].data;
    expect(used).toMatchObject({ userId: "u1", after: { setId: "set-1", remaining: 3 } });
    expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/ABCDE|abcde/);
  });

  it("a code already used (or claimed by a concurrent attempt) is refused and counts against the shared two-step lockout", async () => {
    m.codeFindFirst.mockResolvedValue({ id: "code-1", setId: "set-1" });
    m.codeUpdateMany.mockResolvedValue({ count: 0 });
    const response = await attempt("ABCDE-FGHJK", "backup");
    expect(response.status).toBe(401);
    expect(m.recordFailed).toHaveBeenCalledWith("2fa:a@x.invalid");
    expect(m.notice).not.toHaveBeenCalled();
    const failed = m.audit.mock.calls.find((call) => call[0].data.action === "TWO_FACTOR_BACKUP_CODE_FAILED")![0].data;
    expect(JSON.stringify(failed)).not.toMatch(/ABCDE|abcde/);
  });

  it("wrong authenticator codes and wrong backup codes share one counter", async () => {
    m.verifyTotp.mockReturnValue(false);
    m.codeFindFirst.mockResolvedValue(null);
    await attempt("123456");
    await attempt("zzzzz-zzzzz", "backup");
    expect(m.recordFailed.mock.calls).toEqual([["2fa:a@x.invalid"], ["2fa:a@x.invalid"]]);
  });

  it("a locked account is refused before any code is looked at", async () => {
    m.lockout.mockResolvedValue({ ok: false, message: "Too many failed attempts. Try again in 15 minute(s)." });
    expect((await attempt("ABCDE-FGHJK", "backup")).status).toBe(429);
    expect(m.codeFindFirst).not.toHaveBeenCalled();
    expect(m.codeUpdateMany).not.toHaveBeenCalled();
  });

  it("older screens that send a 10-character code in the code field still work", async () => {
    m.verifyTotp.mockReturnValue(false);
    m.codeFindFirst.mockResolvedValue({ id: "code-2", setId: "legacy_u1" });
    m.codeUpdateMany.mockResolvedValue({ count: 1 });
    m.codeCount.mockResolvedValue(8);
    const response = await attempt("a1b2c-3d4e5");
    expect((await response.json()).backupCode).toMatchObject({ remaining: 8, makeNewSuggested: false });
  });
});

describe("the notice", () => {
  it("goes once per used code through the pipeline with explicit inbox and email transports", async () => {
    vi.doUnmock("@/lib/auth/backup-code-notice");
    vi.resetModules();
    const { sendBackupCodeUsedNotice } = await import("@/lib/auth/backup-code-notice");
    m.office.mockResolvedValue([]);
    await sendBackupCodeUsedNotice({ user: { id: "u1", role: "CLEANER" as never, name: "Alex", email: "a@x.invalid" }, codeId: "code-9", usedAt: new Date("2026-11-17T01:05:00Z"), remaining: 2, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1" });
    expect(m.office).toHaveBeenCalledTimes(1);
    const input = m.office.mock.calls[0][0];
    expect(input).toMatchObject({
      typeKey: "account.backup_code_used",
      eventKey: "account.backup_code_used",
      eventId: "backup-code-used:code-9",
      scopeType: "ACCOUNT_HOLDER",
      transports: ["INBOX", "EMAIL"],
      respectsPreferences: false,
      category: "account",
      url: "/v2/cleaner/profile",
    });
    expect(input.body).toContain("Safari on iPhone");
    expect(input.body).toContain("2 left");
    expect(input.body).toContain("12:05 pm");
    const email = input.email();
    expect(email.subject).toBe("A backup code was used to sign in");
    expect(email.html).toContain("Safari on iPhone");
  });
});

describe("turning two-step off and an administrator's reset", () => {
  it("turning it off deletes the codes and audits the deletion", async () => {
    m.userFind.mockResolvedValue({ passwordHash: "hash" });
    m.bcrypt.mockResolvedValue(true);
    m.codeDelete.mockResolvedValue({ count: 7 });
    expect((await settingsRoute.DELETE(json({ password: "pw" }, "DELETE"))).status).toBe(200);
    expect(m.codeDelete).toHaveBeenCalledWith({ where: { userId: "me" } });
    expect(m.audit.mock.calls.map((call) => call[0].data)).toContainEqual(expect.objectContaining({ userId: "me", action: "TWO_FACTOR_BACKUP_CODES_DELETED", after: { reason: "two_step_turned_off", count: 7 } }));
  });

  it("an administrator's reset deletes the person's codes, recorded against the administrator", async () => {
    m.userFind.mockResolvedValue({ id: "target", name: "T", email: "t@x.invalid", twoFactorEnabled: false });
    m.codeDelete.mockResolvedValue({ count: 10 });
    const response = await resetRoute.POST(json({ security: { pin: "1234" } }), { params: { id: "target" } });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("me", { pin: "1234" });
    expect(m.codeDelete).toHaveBeenCalledWith({ where: { userId: "target" } });
    expect(m.audit.mock.calls.map((call) => call[0].data)).toContainEqual(expect.objectContaining({ userId: "me", action: "TWO_FACTOR_BACKUP_CODES_DELETED", entityId: "target" }));
    expect(m.audit.mock.calls.map((call) => call[0].data.action)).toContain("RESET_USER_2FA");
  });
});
