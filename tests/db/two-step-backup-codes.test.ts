// @vitest-environment node
/**
 * Two-step backup codes against real PostgreSQL (2026-11-17): only hashes are
 * stored; each code works once, also when two sign-ins race with the same
 * code; wrong backup codes lock the account exactly like wrong two-step codes
 * (one shared counter); a new set cancels the old one; turning two-step off
 * deletes the codes; codes copied from the older store keep working.
 *
 * Needs SNEEK_TEST_DATABASE_URL on 127.0.0.1:55439 (a disposable database).
 * Fixture users are deleted afterwards (their codes, audit rows and lockout
 * rows with them).
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, notice: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_target, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }),
}));
vi.mock("@/lib/auth/backup-code-notice", () => ({ sendBackupCodeUsedNotice: m.notice }));

import { backupCodeStatus, createBackupCodeSet, deleteBackupCodes, redeemBackupCode } from "@/lib/auth/backup-codes";
import { normalizeBackupCodeInput } from "@/lib/auth/backup-code-format";
import { LOGIN_MAX_ATTEMPTS } from "@/lib/auth/login-lockout";
import * as completeRoute from "@/app/api/auth/2fa/complete/route";

const url = process.env.SNEEK_TEST_DATABASE_URL;
process.env.NEXTAUTH_SECRET ??= "backup-codes-fixture-signing-key";

let userId: string;
let email: string;
const PASSWORD = "fixture-only-password";

function signIn(code: string, method?: string) {
  return completeRoute.POST(new NextRequest("http://localhost/api/auth/2fa/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0" },
    body: JSON.stringify({ email, password: PASSWORD, code, ...(method ? { method } : {}) }),
  }));
}

describe.skipIf(!url)("two-step backup codes with real storage", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture DB required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    userId = `qa-backup-${randomUUID()}`;
    email = `${userId}@example.invalid`;
    m.notice.mockReset();
    m.notice.mockResolvedValue([]);
    await m.client.user.create({
      data: { id: userId, email, role: "CLEANER", passwordHash: await bcrypt.hash(PASSWORD, 4), twoFactorEnabled: true, twoFactorMethod: "TOTP", totpSecret: "JBSWY3DPEHPK3PXP" },
    });
  });

  afterEach(async () => {
    await m.client.appSetting.deleteMany({ where: { key: `loginLockout:2fa:${email}` } });
    await m.client.auditLog.deleteMany({ where: { userId } });
    await m.client.user.deleteMany({ where: { id: userId } });
  });

  afterAll(async () => {
    await m.client?.$disconnect();
  });

  it("stores only hashes, with when they were made", async () => {
    const set = await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    const rows = await m.client.twoFactorBackupCode.findMany({ where: { userId } });
    expect(rows).toHaveLength(10);
    const stored = JSON.stringify(rows);
    for (const code of set.codes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(normalizeBackupCodeInput(code));
      expect(stored).not.toContain(code.toLowerCase());
    }
    for (const row of rows) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.usedAt).toBeNull();
    }
    expect(await backupCodeStatus(userId)).toMatchObject({ total: 10, remaining: 10, olderSet: false });
  });

  it("a code works once", async () => {
    const { codes } = await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    const first = await redeemBackupCode(userId, codes[0].toLowerCase().replace("-", " "));
    expect(first).toMatchObject({ ok: true, remaining: 9 });
    expect(await redeemBackupCode(userId, codes[0])).toEqual({ ok: false, reason: "no_match" });
    expect(await backupCodeStatus(userId)).toMatchObject({ total: 10, remaining: 9 });
  });

  it("two sign-ins racing with the same code: exactly one succeeds, one notice", async () => {
    const { codes } = await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    const responses = await Promise.all(Array.from({ length: 5 }, () => signIn(codes[3], "backup")));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 401, 401, 401, 401]);
    expect(await m.client.twoFactorBackupCode.count({ where: { userId, usedAt: { not: null } } })).toBe(1);
    expect(m.notice).toHaveBeenCalledTimes(1);
    expect(await m.client.auditLog.count({ where: { userId, action: "TWO_FACTOR_BACKUP_CODE_USED" } })).toBe(1);
    const audits = await m.client.auditLog.findMany({ where: { userId } });
    expect(JSON.stringify(audits)).not.toContain(codes[3]);
    expect(JSON.stringify(audits)).not.toContain(normalizeBackupCodeInput(codes[3]));
  });

  it("wrong backup codes and wrong authenticator codes share one lockout", async () => {
    const { codes } = await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS - 1; attempt++) {
      expect((await signIn("ZZZZZ-ZZZZZ", "backup")).status).toBe(401);
    }
    // The eighth wrong answer is a 6-digit code: the same counter locks.
    expect((await signIn("000000")).status).toBe(401);
    const locked = await signIn(codes[0], "backup");
    expect(locked.status).toBe(429);
    // A valid code during the lock is not used up.
    expect(await m.client.twoFactorBackupCode.count({ where: { userId, usedAt: { not: null } } })).toBe(0);
    expect(await m.client.auditLog.count({ where: { userId, action: "TWO_FACTOR_BACKUP_CODE_FAILED" } })).toBe(LOGIN_MAX_ATTEMPTS - 1);
  });

  it("a new set cancels every older code", async () => {
    const old = await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    await redeemBackupCode(userId, old.codes[0]);
    const fresh = await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    expect(fresh.replaced).toBe(10);
    expect(await redeemBackupCode(userId, old.codes[1])).toEqual({ ok: false, reason: "no_match" });
    expect(await redeemBackupCode(userId, fresh.codes[1])).toMatchObject({ ok: true, remaining: 9 });
  });

  it("turning two-step off deletes the codes", async () => {
    await m.client.$transaction((tx) => createBackupCodeSet(tx, userId));
    expect(await m.client.$transaction((tx) => deleteBackupCodes(tx, userId))).toBe(10);
    expect(await backupCodeStatus(userId)).toEqual({ total: 0, remaining: 0, createdAt: null, olderSet: false });
  });

  it("a code copied from the older store still works once, and its date is not invented", async () => {
    const older = "a1b2c-3d4e5";
    await m.client.twoFactorBackupCode.create({
      data: { userId, setId: `legacy_${userId}`, codeHash: createHash("sha256").update(older).digest("hex"), hashScheme: "sha256-legacy", createdAt: null },
    });
    expect(await backupCodeStatus(userId)).toEqual({ total: 1, remaining: 1, createdAt: null, olderSet: true });
    const response = await signIn("A1B2C 3D4E5");
    expect(response.status).toBe(200);
    expect((await response.json()).backupCode).toMatchObject({ remaining: 0, makeNewSuggested: true, newCodesPath: null });
    expect((await signIn(older, "backup")).status).toBe(401);
  });
});
