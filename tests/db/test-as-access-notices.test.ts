// @vitest-environment node
/**
 * Owner defaults (pending owner confirmation), against real PostgreSQL and the
 * real notification intent pipeline:
 * - "Ask an administrator" (board "Access denied"): an inbox-only message to
 *   the active administrators, at most once per person per area per day (also
 *   when two clicks race), never to the requester, and it grants nothing.
 * - "Someone tested the app as you" (board "Test as"): an inbox note to the
 *   person, only after FULL access, once per session (stop, sweep and repeats
 *   all collapse to one), naming who and when, never what was viewed.
 *
 * Needs SNEEK_TEST_DATABASE_URL on 127.0.0.1:55439 (a disposable database).
 * Fixture users, their intents, notifications and audit rows are deleted.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_target, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }),
}));

import { requestAreaAccess } from "@/lib/access/access-request";
import { TESTED_AS_NOTIFIED_ACTION, sendTestedAsNotice, sweepTestedAsNotices } from "@/lib/auth/tested-as-notice";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const run = randomUUID().slice(0, 8);
const ids = { adminA: `qa-ta-admin-a-${run}`, adminB: `qa-ta-admin-b-${run}`, manager: `qa-ta-ops-${run}`, cleaner: `qa-ta-cleaner-${run}` };
const everyone = Object.values(ids);

async function intentsFor(where: { eventKey: string }) {
  return m.client.notificationIntent.findMany({ where: { ...where, recipientId: { in: everyone } }, orderBy: { createdAt: "asc" } });
}

describe.skipIf(!url)("Test as and access request notices with real storage", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture DB required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    await m.client.user.createMany({
      data: [
        { id: ids.adminA, email: `${ids.adminA}@example.invalid`, name: "Hannah Lee", role: "ADMIN" },
        { id: ids.adminB, email: `${ids.adminB}@example.invalid`, name: "Ravi Mehta", role: "ADMIN" },
        { id: ids.manager, email: `${ids.manager}@example.invalid`, name: "Chloe Martin", role: "OPS_MANAGER" },
        { id: ids.cleaner, email: `${ids.cleaner}@example.invalid`, name: "Marco Rossi", role: "CLEANER" },
      ],
    });
  });

  afterEach(async () => {
    const intents = await m.client.notificationIntent.findMany({ where: { recipientId: { in: everyone } }, select: { id: true } });
    await m.client.notificationAttempt.deleteMany({ where: { intentId: { in: intents.map((row) => row.id) } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: everyone } } });
    await m.client.notification.deleteMany({ where: { userId: { in: everyone } } });
    const starts = await m.client.auditLog.findMany({ where: { userId: { in: everyone } }, select: { id: true } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ userId: { in: everyone } }, { entityId: { in: [...everyone, ...starts.map((row) => row.id)] } }] } });
    await m.client.user.deleteMany({ where: { id: { in: everyone } } });
  });

  afterAll(async () => {
    await m.client?.$disconnect();
  });

  const ask = (area: "finance" | "payroll") =>
    requestAreaAccess({ requester: { id: ids.manager, name: "Chloe Martin", email: null }, area, fromPage: "Invoices and pay", fromPath: "/v2/admin/finance/invoices" });

  it("sends one inbox-only message to each administrator, never the requester, and grants nothing", async () => {
    const policyBefore = await m.client.appSetting.findUnique({ where: { key: "ops_feature_permissions_v1" } });
    const result = await ask("finance");
    expect(result).toMatchObject({ ok: true, outcome: { state: "sent", recipients: 2 } });
    const intents = await intentsFor({ eventKey: "access.request" });
    expect(intents.map((row) => row.recipientId).sort()).toEqual([ids.adminA, ids.adminB].sort());
    expect(new Set(intents.map((row) => row.transport))).toEqual(new Set(["INBOX"]));
    const body = (intents[0].envelope as { body: string }).body;
    expect(body).toBe("Chloe Martin asked for Finance and invoicing, from Invoices and pay. Nothing changes until an administrator updates their access in Settings › Access and permissions.");
    expect((intents[0].envelope as { mobilePushCategory?: string }).mobilePushCategory).toBeUndefined();
    const policyAfter = await m.client.appSetting.findUnique({ where: { key: "ops_feature_permissions_v1" } });
    expect(policyAfter?.value ?? null).toEqual(policyBefore?.value ?? null);
    const audit = await m.client.auditLog.findMany({ where: { userId: ids.manager, action: "ACCESS_REQUESTED" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({ state: "sent", grants: "nothing", area: "finance" });
  });

  it("allows one request per person per area per day, also when two clicks race", async () => {
    const [first, second] = await Promise.all([ask("finance"), ask("finance")]);
    const states = [first, second].map((result) => (result.ok ? result.outcome.state : "error")).sort();
    expect(states).toEqual(["already_asked", "sent"]);
    expect(await ask("finance")).toMatchObject({ ok: true, outcome: { state: "already_asked" } });
    expect(await intentsFor({ eventKey: "access.request" })).toHaveLength(2);
    // Another area is its own request.
    expect(await ask("payroll")).toMatchObject({ ok: true, outcome: { state: "sent" } });
    expect(await intentsFor({ eventKey: "access.request" })).toHaveLength(4);
  });

  async function start(mode: "FULL" | "READ_ONLY", minutesAgo = 5) {
    return m.client.auditLog.create({
      data: { userId: ids.adminA, action: "IMPERSONATE_START", entity: "User", entityId: ids.cleaner, createdAt: new Date(Date.now() - minutesAgo * 60_000), after: { mode, targetRole: "CLEANER" } },
    });
  }

  it("tells the person once after full access, by inbox only, naming who and when", async () => {
    const session = await start("FULL");
    const sent = await sendTestedAsNotice({ startAuditId: session.id, endedAt: new Date() });
    expect(sent.sent).toBe(true);
    expect(await sendTestedAsNotice({ startAuditId: session.id, endedAt: new Date() })).toEqual({ sent: false, reason: "already_notified" });
    const intents = await intentsFor({ eventKey: "account.tested_as" });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ recipientId: ids.cleaner, transport: "INBOX" });
    const body = (intents[0].envelope as { body: string }).body;
    expect(body).toMatch(/^Hannah Lee from the office used Test as to open the app as you, with full access, from .+ to .+\./);
    expect(body).not.toMatch(/\/v2\/|job|invoice/i);
    expect(await m.client.auditLog.count({ where: { action: TESTED_AS_NOTIFIED_ACTION, entityId: session.id } })).toBe(1);
  });

  it("says nothing after view only", async () => {
    const session = await start("READ_ONLY");
    expect(await sendTestedAsNotice({ startAuditId: session.id, endedAt: new Date() })).toEqual({ sent: false, reason: "not_full" });
    expect(await intentsFor({ eventKey: "account.tested_as" })).toHaveLength(0);
  });

  it("the sweep tells people about full sessions that ended by themselves, once", async () => {
    await start("FULL", 90);
    await start("READ_ONLY", 90);
    const recent = await start("FULL", 10);
    const first = await sweepTestedAsNotices();
    expect(first.sent).toBe(1);
    expect((await sweepTestedAsNotices()).sent).toBe(0);
    expect(await intentsFor({ eventKey: "account.tested_as" })).toHaveLength(1);
    // The session still inside its hour waits; stopping it later sends its own one note.
    expect(await m.client.auditLog.count({ where: { action: TESTED_AS_NOTIFIED_ACTION, entityId: recent.id } })).toBe(0);
  });
});
