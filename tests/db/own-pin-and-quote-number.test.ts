// @vitest-environment node
/**
 * Owner decisions 2026-11-13 on a real disposable PostgreSQL (127.0.0.1:55439):
 *
 * Own PIN for sensitive actions — each person's own PIN only, another
 * person's PIN refused, Test as refused, password-only refused once a PIN
 * exists, the one-time "password + new PIN" transition for someone with no
 * PIN (nobody locked out), lockout after repeated wrong attempts held in the
 * database, set/change needing the current password, and an administrator's
 * reset that clears (never reveals) the PIN.
 *
 * Quote reference numbers — unique under concurrent creation, never reused
 * after a delete.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, actor: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
// The signed-in person and Test as are read from the request; here they are set per test.
vi.mock("@/lib/security/actual-actor", () => ({ actualActorRefusal: m.actor }));

import { clearAdminPin, getAdminPinState, setAdminPin, verifySensitiveAction } from "@/lib/security/admin-verification";
import { resetPersonPin } from "@/lib/security/own-pin";
import { PIN_LOCK_THRESHOLD } from "@/lib/security/pin-rules";
import { issueQuoteNumber } from "@/lib/quotes/quote-number";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `pin-${randomUUID().slice(0, 8)}`;
const ids = { admin: randomUUID(), ops: randomUUID(), other: randomUUID() };
const quoteIds: string[] = [];

/** Acting as `who`, signed in as themselves, not testing as anyone. */
function actAs(who: string) {
  m.actor.mockImplementation(async (userId: string) => (userId === who ? null : "ACTUAL_ACTOR_REQUIRED"));
}

describe.skipIf(!url)("own PINs and quote numbers (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    const passwordHash = await bcrypt.hash("correct horse", 10);
    await m.client.user.createMany({ data: [
      { id: ids.admin, email: `${tag}-admin@example.invalid`, name: "Ada", role: Role.ADMIN, passwordHash },
      { id: ids.ops, email: `${tag}-ops@example.invalid`, name: "Olly", role: Role.OPS_MANAGER, passwordHash },
      { id: ids.other, email: `${tag}-other@example.invalid`, name: "Oscar", role: Role.OPS_MANAGER, passwordHash },
    ] });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await m.client.userSecurityPin.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await m.client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await m.client.$disconnect();
  });

  beforeEach(() => {
    m.actor.mockReset();
  });

  // Changed 2026-11-14 (owner default, pending confirmation): with no PIN the
  // password alone confirms; a password sent with a valid new PIN still sets it.
  it("lets someone with no PIN confirm with their password, stores a new PIN sent with it, then only accepts that PIN", async () => {
    actAs(ids.ops);
    await expect(verifySensitiveAction(ids.ops, {})).rejects.toMatchObject({ code: "PIN_SETUP_REQUIRED" });
    await expect(verifySensitiveAction(ids.ops, { password: "correct horse" })).resolves.toBe(true);
    expect((await getAdminPinState(ids.ops)).hasPin).toBe(false);
    await expect(verifySensitiveAction(ids.ops, { password: "correct horse", newPin: "1111" })).rejects.toMatchObject({ code: "NEW_PIN_INVALID" });
    await expect(verifySensitiveAction(ids.ops, { password: "correct horse", newPin: "4826" })).resolves.toBe(true);

    const row = await m.client.userSecurityPin.findUniqueOrThrow({ where: { userId: ids.ops } });
    expect(row.pinHash).toMatch(/^\$2[aby]\$/);
    expect(row.pinHash).not.toContain("4826");
    expect(await getAdminPinState(ids.ops)).toMatchObject({ hasPin: true, lockedUntil: null });
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { userId: ids.ops, action: "SECURITY_PIN_SET" } });
    expect(JSON.stringify(audit.after)).not.toContain("4826");

    await expect(verifySensitiveAction(ids.ops, { pin: "4826" })).resolves.toBe(true);
    // The password no longer confirms once a PIN exists.
    await expect(verifySensitiveAction(ids.ops, { password: "correct horse" })).rejects.toMatchObject({ code: "PIN_REQUIRED" });
  });

  it("never accepts another person's PIN, and never while testing as someone else", async () => {
    actAs(ids.other);
    await verifySensitiveAction(ids.other, { password: "correct horse", newPin: "9137" });
    // Olly (4826) cannot use Oscar's PIN, and Oscar cannot use Olly's.
    actAs(ids.ops);
    await expect(verifySensitiveAction(ids.ops, { pin: "9137" })).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
    actAs(ids.other);
    await expect(verifySensitiveAction(ids.other, { pin: "4826" })).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
    // An administrator signed in as themselves cannot be verified as Olly (a caller passing someone else's id).
    actAs(ids.admin);
    await expect(verifySensitiveAction(ids.ops, { pin: "4826" })).rejects.toMatchObject({ code: "ACTUAL_ACTOR_REQUIRED" });
    // Testing as someone: refused even with the right PIN.
    m.actor.mockResolvedValue("ACTUAL_ACTOR_REQUIRED");
    await expect(verifySensitiveAction(ids.other, { pin: "9137" })).rejects.toMatchObject({ code: "ACTUAL_ACTOR_REQUIRED" });
    await m.client.userSecurityPin.updateMany({ where: { userId: { in: [ids.ops, ids.other] } }, data: { failedAttempts: 0 } });
  });

  it("locks verification after repeated wrong attempts, in the database, until it expires or an administrator resets the PIN", async () => {
    actAs(ids.ops);
    for (let attempt = 1; attempt < PIN_LOCK_THRESHOLD; attempt += 1) {
      await expect(verifySensitiveAction(ids.ops, { pin: "0000" })).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
    }
    await expect(verifySensitiveAction(ids.ops, { pin: "0000" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    // Even the right PIN is refused while locked.
    await expect(verifySensitiveAction(ids.ops, { pin: "4826" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    const state = await getAdminPinState(ids.ops);
    expect(state.lockedUntil).not.toBeNull();
    expect(await m.client.auditLog.count({ where: { userId: ids.ops, action: "SECURITY_PIN_LOCKED" } })).toBe(1);

    // An expired lock lets the right PIN through again and clears the count.
    await m.client.userSecurityPin.update({ where: { userId: ids.ops }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await expect(verifySensitiveAction(ids.ops, { pin: "4826" })).resolves.toBe(true);
    expect((await m.client.userSecurityPin.findUniqueOrThrow({ where: { userId: ids.ops } })).lockedUntil).toBeNull();
  });

  it("needs the current password to set, change or remove one's own PIN", async () => {
    actAs(ids.admin);
    await expect(setAdminPin(ids.admin, "2468", "wrong password")).rejects.toThrow(/Current password is incorrect/);
    expect((await getAdminPinState(ids.admin)).hasPin).toBe(false);
    await setAdminPin(ids.admin, "2468", "correct horse");
    await expect(verifySensitiveAction(ids.admin, { pin: "2468" })).resolves.toBe(true);
    await setAdminPin(ids.admin, "8642", "correct horse");
    await expect(verifySensitiveAction(ids.admin, { pin: "2468" })).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
    await expect(verifySensitiveAction(ids.admin, { pin: "8642" })).resolves.toBe(true);
    expect(await m.client.auditLog.count({ where: { userId: ids.admin, action: "SECURITY_PIN_CHANGED" } })).toBe(1);
    await expect(clearAdminPin(ids.admin, "nope")).rejects.toThrow(/Current password is incorrect/);
    expect((await getAdminPinState(ids.admin)).hasPin).toBe(true);
  });

  it("lets an administrator clear another person's PIN without ever seeing it; that person sets a new one with their password", async () => {
    const before = await m.client.userSecurityPin.findUniqueOrThrow({ where: { userId: ids.other } });
    const result = await resetPersonPin(ids.admin, ids.other);
    expect(result).toEqual({ hadPin: true });
    const after = await m.client.userSecurityPin.findUniqueOrThrow({ where: { userId: ids.other } });
    expect(after).toMatchObject({ pinHash: null, resetById: ids.admin, failedAttempts: 0, lockedUntil: null });
    expect(before.pinHash).not.toBeNull();
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { userId: ids.admin, action: "SECURITY_PIN_RESET", entityId: ids.other } });
    expect(JSON.stringify(audit.after)).not.toMatch(/\$2[aby]\$/);
    expect(await getAdminPinState(ids.other)).toMatchObject({ hasPin: false, resetByAdministrator: true });

    actAs(ids.other);
    await expect(verifySensitiveAction(ids.other, { pin: "9137" })).rejects.toMatchObject({ code: "PIN_SETUP_REQUIRED" });
    await expect(verifySensitiveAction(ids.other, { password: "correct horse", newPin: "7351" })).resolves.toBe(true);
    await expect(verifySensitiveAction(ids.other, { pin: "7351" })).resolves.toBe(true);
  });

  it("issues unique quote numbers to concurrent creations and never reuses a deleted quote's number", async () => {
    const create = () =>
      m.client.$transaction(async (tx) => {
        const quoteNumber = await issueQuoteNumber(tx);
        return tx.quote.create({ data: { quoteNumber, serviceType: "GENERAL_CLEAN", lineItems: [], subtotal: 100, gstAmount: 10, totalAmount: 110, notes: tag } });
      });
    const created = await Promise.all(Array.from({ length: 12 }, () => create()));
    quoteIds.push(...created.map((quote) => quote.id));
    const numbers = created.map((quote) => quote.quoteNumber).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(12);
    // Consecutive: no number was handed to two quotes, none skipped by the race.
    expect(numbers[11] - numbers[0]).toBe(11);

    const highest = created.find((quote) => quote.quoteNumber === numbers[11])!;
    await m.client.quote.delete({ where: { id: highest.id } });
    const next = await create();
    quoteIds.push(next.id);
    expect(next.quoteNumber).toBe(numbers[11] + 1);

    // A failed save rolls the number back with it, so no quote is skipped or doubled.
    await expect(
      m.client.$transaction(async (tx) => {
        await issueQuoteNumber(tx);
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");
    const after = await create();
    quoteIds.push(after.id);
    expect(after.quoteNumber).toBe(next.quoteNumber + 1);
  });
});
