// @vitest-environment node
/**
 * "Simpler confirmations" (board approved 2026-11-14) on a real disposable
 * PostgreSQL (127.0.0.1:55439): the tier C credential rule.
 *
 *   - a person WITH a PIN confirms with that PIN only; their password is
 *     refused (PIN_REQUIRED) and never counts as a confirmation;
 *   - a person with NO PIN confirms with their account password alone (owner
 *     default, pending owner confirmation), and no PIN is created by it;
 *   - wrong PINs and wrong passwords share the unchanged lockout
 *     (PIN_LOCK_THRESHOLD in a row → locked PIN_LOCK_MINUTES), and a locked
 *     person is refused even with the right credential;
 *   - refused while testing as someone else, before any credential is read;
 *   - every accepted confirmation writes SENSITIVE_ACTION_CONFIRMED against the
 *     actual actor naming the action and which credential was used, never the value.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, actor: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/security/actual-actor", () => ({ actualActorRefusal: m.actor }));

import { verifySensitiveAction, verifySensitiveActionCredential } from "@/lib/security/admin-verification";
import { storeOwnPin } from "@/lib/security/own-pin";
import { PIN_LOCK_MINUTES, PIN_LOCK_THRESHOLD } from "@/lib/security/pin-rules";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `cred-${randomUUID().slice(0, 8)}`;
const ids = { withPin: randomUUID(), noPin: randomUUID(), locker: randomUUID() };

function actAs(who: string) {
  m.actor.mockImplementation(async (userId: string) => (userId === who ? null : "ACTUAL_ACTOR_REQUIRED"));
}

async function confirmations(userId: string) {
  return m.client.auditLog.findMany({ where: { userId, action: "SENSITIVE_ACTION_CONFIRMED" }, orderBy: { createdAt: "asc" } });
}

describe.skipIf(!url)("tier C credential rule (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    const passwordHash = await bcrypt.hash("correct horse", 10);
    await m.client.user.createMany({ data: [
      { id: ids.withPin, email: `${tag}-a@example.invalid`, name: "Ada", role: Role.ADMIN, passwordHash },
      { id: ids.noPin, email: `${tag}-b@example.invalid`, name: "Bo", role: Role.ADMIN, passwordHash },
      { id: ids.locker, email: `${tag}-c@example.invalid`, name: "Cy", role: Role.ADMIN, passwordHash },
    ] });
    await storeOwnPin(ids.withPin, "4826", "profile");
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await m.client.userSecurityPin.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await m.client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await m.client.$disconnect();
  });

  beforeEach(() => m.actor.mockReset());

  it("requires the PIN when the person has one and never accepts their password", async () => {
    actAs(ids.withPin);
    await expect(verifySensitiveAction(ids.withPin, { password: "correct horse" }, "jobs.delete")).rejects.toMatchObject({ code: "PIN_REQUIRED" });
    await expect(verifySensitiveAction(ids.withPin, {}, "jobs.delete")).rejects.toMatchObject({ code: "PIN_OR_PASSWORD_REQUIRED" });
    expect(await confirmations(ids.withPin)).toHaveLength(0);
    await expect(verifySensitiveActionCredential(ids.withPin, { pin: "4826" }, "jobs.delete")).resolves.toEqual({ credential: "pin" });
    const [audit] = await confirmations(ids.withPin);
    expect(audit.after).toEqual({ action: "jobs.delete", credential: "pin" });
    expect(JSON.stringify(audit.after)).not.toContain("4826");
  });

  it("accepts the password alone when the person has no PIN, records it, and creates no PIN", async () => {
    actAs(ids.noPin);
    await expect(verifySensitiveActionCredential(ids.noPin, { password: "correct horse" }, "cleaner_invoices.delete")).resolves.toEqual({ credential: "password" });
    const row = await m.client.userSecurityPin.findUnique({ where: { userId: ids.noPin } });
    expect(row?.pinHash ?? null).toBeNull();
    const [audit] = await confirmations(ids.noPin);
    expect(audit.after).toEqual({ action: "cleaner_invoices.delete", credential: "password" });
    expect(JSON.stringify(audit.after)).not.toContain("correct horse");
    // A PIN typed by someone with no PIN is not a credential.
    await expect(verifySensitiveAction(ids.noPin, { pin: "4826" })).rejects.toMatchObject({ code: "PIN_SETUP_REQUIRED" });
  });

  it("still stores a new PIN sent with the password (older prompts), recorded as password_and_new_pin", async () => {
    actAs(ids.noPin);
    await expect(verifySensitiveActionCredential(ids.noPin, { password: "correct horse", newPin: "5937" })).resolves.toEqual({ credential: "password_and_new_pin" });
    const audits = await confirmations(ids.noPin);
    expect(audits.at(-1)?.after).toEqual({ action: null, credential: "password_and_new_pin" });
    await expect(verifySensitiveAction(ids.noPin, { password: "correct horse" })).rejects.toMatchObject({ code: "PIN_REQUIRED" });
    await expect(verifySensitiveAction(ids.noPin, { pin: "5937" })).resolves.toBe(true);
  });

  it("counts wrong passwords toward the unchanged lockout and refuses the right password while locked", async () => {
    actAs(ids.locker);
    for (let attempt = 1; attempt < PIN_LOCK_THRESHOLD; attempt += 1) {
      await expect(verifySensitiveAction(ids.locker, { password: "wrong" })).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
    }
    const started = Date.now();
    await expect(verifySensitiveAction(ids.locker, { password: "wrong" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    await expect(verifySensitiveAction(ids.locker, { password: "correct horse" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    const row = await m.client.userSecurityPin.findUniqueOrThrow({ where: { userId: ids.locker } });
    const minutes = (row.lockedUntil!.getTime() - started) / 60_000;
    expect(minutes).toBeGreaterThan(PIN_LOCK_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(PIN_LOCK_MINUTES + 0.1);
    expect(await m.client.auditLog.count({ where: { userId: ids.locker, action: "SECURITY_PIN_LOCKED" } })).toBe(1);
    expect(await confirmations(ids.locker)).toHaveLength(0);
    // Once the lock expires the password works again and the count is cleared.
    await m.client.userSecurityPin.update({ where: { userId: ids.locker }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await expect(verifySensitiveAction(ids.locker, { password: "correct horse" })).resolves.toBe(true);
    expect((await m.client.userSecurityPin.findUniqueOrThrow({ where: { userId: ids.locker } })).failedAttempts).toBe(0);
  });

  it("refuses while testing as someone else, even with the right credential, without counting a failure", async () => {
    m.actor.mockResolvedValue("ACTUAL_ACTOR_REQUIRED");
    const before = (await m.client.userSecurityPin.findUnique({ where: { userId: ids.withPin } }))?.failedAttempts ?? 0;
    await expect(verifySensitiveAction(ids.withPin, { pin: "4826" })).rejects.toMatchObject({ code: "ACTUAL_ACTOR_REQUIRED" });
    await expect(verifySensitiveAction(ids.locker, { password: "correct horse" })).rejects.toMatchObject({ code: "ACTUAL_ACTOR_REQUIRED" });
    expect((await m.client.userSecurityPin.findUnique({ where: { userId: ids.withPin } }))?.failedAttempts ?? 0).toBe(before);
  });
});
