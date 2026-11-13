// @vitest-environment node
/**
 * Scheduling rules against a real disposable PostgreSQL (SNEEK_TEST_DATABASE_URL,
 * loopback only): seeding version 1 from the LIVE settings row, the locked
 * publish flow (unlock, PIN, reason, confirm, effective day, stale and
 * cool-down refusals, snapshot, audit), activation into the settings row,
 * generic saves that cannot touch rule fields, restore, backups and fail-closed
 * reads of a damaged row.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/security/admin-verification", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/security/admin-verification")>();
  return {
    ...original,
    // The person's own PIN check itself is covered by tests/db/own-pin-and-quote-number.test.ts.
    verifySensitiveAction: vi.fn(async (_userId: string, credentials: { pin?: string } | null, action?: string) => {
      if (action !== "scheduling.rules_edit") throw new Error("wrong action");
      if (credentials?.pin !== "2468") throw new original.SensitiveVerificationError("INVALID_SECURITY_VERIFICATION");
      return true;
    }),
  };
});

import { DEFAULT_SETTINGS, getTransactionAppSettings, saveAppSettings } from "@/lib/settings";
import { loadSchedulingRuleBook, SchedulingRulesUnavailableError } from "@/lib/scheduling-rules/store";
import { publishRules, unlockRules, RulesEditError } from "@/lib/scheduling-rules/service";
import { buildSchedulingRulesBackup, readSchedulingRulesBackup, takeSchedulingRuleSnapshot } from "@/lib/scheduling-rules/backup";
import { canonicalRuleValues } from "@/lib/scheduling-rules/values";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `sched-${randomUUID().slice(0, 8)}`;
const adminId = `${tag}-admin`;
const opsId = `${tag}-ops`;
const adminSession = { user: { id: adminId, role: "ADMIN", heldRoles: ["ADMIN"] } } as any;
const opsSession = { user: { id: opsId, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } } as any;
const testingAsSession = { user: { id: opsId, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] }, impersonation: { adminId, targetId: opsId } } as any;

const T0 = new Date("2026-11-20T01:00:00Z"); // 12:00 Sydney, 20 Nov 2026
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function reset() {
  await m.client.schedulingRuleSnapshot.deleteMany({});
  await m.client.schedulingRuleVersion.deleteMany({});
  await m.client.auditLog.deleteMany({ where: { entity: "SchedulingRules" } });
  await m.client.appSetting.deleteMany({ where: { OR: [{ key: "app" }, { key: { startsWith: "scheduling_rules_unlock:" } }] } });
}

function publishInput(token: string, values: unknown, patch: Record<string, unknown> = {}) {
  return { token, credentials: { pin: "2468" }, values, effectiveFrom: "2026-11-21", reason: "Owner asked for a later pickup", expectedLatestVersion: 1, appliesToExisting: false, confirmed: true, kind: "EDIT" as const, ...patch };
}

describe.skipIf(!url)("scheduling rules (database)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
    await m.client.user.createMany({ data: [
      { id: adminId, email: `${tag}-admin@example.invalid`, name: "Ada", role: Role.ADMIN },
      { id: opsId, email: `${tag}-ops@example.invalid`, name: "Olly", role: Role.OPS_MANAGER },
    ] });
  });
  afterAll(async () => {
    if (!m.client) return;
    await reset();
    await m.client.auditLog.deleteMany({ where: { userId: { in: [adminId, opsId] } } });
    await m.client.user.deleteMany({ where: { id: { in: [adminId, opsId] } } });
    await m.client.$disconnect();
  });
  beforeEach(async () => {
    await reset();
    // The LIVE stored settings differ from the code defaults on purpose.
    await m.client.appSetting.create({ data: { key: "app", value: { ...DEFAULT_SETTINGS, laundryOperations: { ...DEFAULT_SETTINGS.laundryOperations, maxOutdoorDays: 6 }, recurringJobs: { enabled: true, lookaheadDays: 21 } } as any } });
  });

  it("seeds version 1 once, from the live settings, never from code defaults", async () => {
    const [a, b, c] = await Promise.all([loadSchedulingRuleBook(m.client, T0), loadSchedulingRuleBook(m.client, T0), loadSchedulingRuleBook(m.client, T0)]);
    expect(await m.client.schedulingRuleVersion.count()).toBe(1);
    for (const book of [a, b, c]) expect(book.live.version).toBe(1);
    expect(a.live.values["laundry.maxOutdoorDays"]).toBe(6);
    expect(a.live.values["jobs.recurringLookaheadDays"]).toBe(21);
    expect(a.live.values["laundry.pickupOffsetDays"]).toBe(1);
    expect(await m.client.auditLog.count({ where: { action: "SCHEDULING_RULES_SEEDED" } })).toBe(1);
  });

  it("refuses to unlock for a manager without the grant and while testing as someone", async () => {
    await loadSchedulingRuleBook(m.client, T0);
    await expect(unlockRules(opsSession, { pin: "2468" }, T0)).rejects.toMatchObject({ status: 403 });
    await expect(unlockRules(testingAsSession, { pin: "2468" }, T0)).rejects.toMatchObject({ status: 403 });
    await expect(unlockRules(adminSession, { pin: "0000" }, T0)).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
  });

  it("publishes only through the locked flow, with snapshot and audit, and refuses stale or hasty publishes", async () => {
    const book = await loadSchedulingRuleBook(m.client, T0);
    const edited = { ...book.live.values, "laundry.pickupOffsetDays": 2 };
    await expect(publishRules(adminSession, publishInput("not-a-token", edited), T0)).rejects.toMatchObject({ status: 423 });
    const { token } = await unlockRules(adminSession, { pin: "2468" }, T0);
    await expect(publishRules(adminSession, publishInput(token, edited, { confirmed: false }), T0)).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    await expect(publishRules(adminSession, publishInput(token, edited, { reason: "short" }), T0)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(publishRules(adminSession, publishInput(token, edited, { effectiveFrom: "2026-11-20" }), T0)).rejects.toMatchObject({ code: "EFFECTIVE_TOO_EARLY" });
    await expect(publishRules(adminSession, publishInput(token, { ...edited, "laundry.pickupOffsetDays": 9 }), T0)).rejects.toMatchObject({ code: "INVALID_VALUES" });
    await expect(publishRules(adminSession, publishInput(token, book.live.values), T0)).rejects.toMatchObject({ code: "NO_CHANGE" });
    await expect(publishRules(adminSession, { ...publishInput(token, edited), credentials: { pin: "1111" } }, T0)).rejects.toMatchObject({ code: "INVALID_SECURITY_VERIFICATION" });
    expect(await m.client.schedulingRuleVersion.count()).toBe(1);

    const results = await Promise.allSettled([publishRules(adminSession, publishInput(token, edited), T0), publishRules(adminSession, publishInput(token, edited), T0)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(RulesEditError);
    expect(["STALE", "COOL_DOWN"]).toContain((refused.reason as RulesEditError).code);

    expect(await m.client.schedulingRuleVersion.count()).toBe(2);
    expect(await m.client.schedulingRuleSnapshot.count({ where: { source: "PRE_PUBLISH" } })).toBe(1);
    const audit = await m.client.auditLog.findFirst({ where: { action: "SCHEDULING_RULES_PUBLISHED" } });
    expect(audit?.after).toMatchObject({ version: 2, effectiveFrom: "2026-11-21", changes: [{ key: "laundry.pickupOffsetDays", from: 1, to: 2 }] });
    await expect(publishRules(adminSession, publishInput(token, { ...edited, "laundry.pickupOffsetDays": 3 }, { expectedLatestVersion: 2 }), minutes(5))).rejects.toMatchObject({ code: "COOL_DOWN" });
    await expect(publishRules(adminSession, publishInput(token, { ...edited, "laundry.pickupOffsetDays": 3 }, { expectedLatestVersion: 1 }), minutes(11))).rejects.toMatchObject({ code: "STALE" });
  });

  it("a version is not live before its day, then mirrors its settings values and blocks generic saves", async () => {
    const book = await loadSchedulingRuleBook(m.client, T0);
    const { token } = await unlockRules(adminSession, { pin: "2468" }, T0);
    await publishRules(adminSession, publishInput(token, { ...book.live.values, "laundry.maxOutdoorDays": 4 }), T0);
    expect((await loadSchedulingRuleBook(m.client, T0)).live.version).toBe(1);
    expect((await getTransactionAppSettings(m.client)).laundryOperations.maxOutdoorDays).toBe(6);
    const dayAfter = new Date("2026-11-20T13:30:00Z"); // 00:30 Sydney on 21 Nov
    const live = await loadSchedulingRuleBook(m.client, dayAfter);
    expect(live.live.version).toBe(2);
    expect((await getTransactionAppSettings(m.client)).laundryOperations.maxOutdoorDays).toBe(4);
    expect(await m.client.auditLog.count({ where: { action: "SCHEDULING_RULES_ACTIVATED" } })).toBe(1);
    // A generic save (settings PATCH, whole-blob restore) cannot change it.
    await saveAppSettings({ laundryOperations: { ...DEFAULT_SETTINGS.laundryOperations, maxOutdoorDays: 9 }, companyName: "Renamed" } as any);
    const after = await getTransactionAppSettings(m.client);
    expect(after.laundryOperations.maxOutdoorDays).toBe(4);
    expect(after.companyName).toBe("Renamed");
  });

  it("restores an earlier version as a new version with exactly its values", async () => {
    const book = await loadSchedulingRuleBook(m.client, T0);
    const { token } = await unlockRules(adminSession, { pin: "2468" }, T0);
    await publishRules(adminSession, publishInput(token, { ...book.live.values, "jobs.turnoverReadyByTime": "14:00" }), T0);
    const later = minutes(12);
    const { token: again } = await unlockRules(adminSession, { pin: "2468" }, later);
    await expect(publishRules(adminSession, publishInput(again, { ...book.live.values, "jobs.turnoverReadyByTime": "13:00" }, { kind: "RESTORE", restoredFromVersion: 1, expectedLatestVersion: 2 }), later)).rejects.toMatchObject({ code: "RESTORE_MISMATCH" });
    const restored = await publishRules(adminSession, publishInput(again, book.live.values, { kind: "RESTORE", restoredFromVersion: 1, expectedLatestVersion: 2, reason: "Undo the accidental change" }), later);
    expect(restored.version).toBe(3);
    const row = await m.client.schedulingRuleVersion.findUnique({ where: { version: 3 } });
    expect(row).toMatchObject({ kind: "RESTORE", restoredFromVersion: 1 });
    expect(row?.values).toEqual(canonicalRuleValues(book.live.values));
  });

  it("backups round-trip, a changed file is refused, and the weekly snapshot is stored", async () => {
    await loadSchedulingRuleBook(m.client, T0);
    const document = await buildSchedulingRulesBackup({ includeExtras: true, now: T0 });
    const read = readSchedulingRulesBackup(JSON.stringify(document));
    expect(read.ok).toBe(true);
    const tampered = JSON.parse(JSON.stringify(document));
    tampered.live.values["laundry.maxOutdoorDays"] = 2;
    expect(readSchedulingRulesBackup(JSON.stringify(tampered))).toMatchObject({ ok: false, problems: [expect.stringMatching(/checksum/)] });
    expect(readSchedulingRulesBackup("not json")).toMatchObject({ ok: false });
    const snapshot = await takeSchedulingRuleSnapshot({ source: "WEEKLY" });
    expect(snapshot.liveVersion).toBe(1);
    expect(await m.client.auditLog.count({ where: { action: "SCHEDULING_RULES_SNAPSHOT" } })).toBe(1);
  });

  it("a damaged stored version stops every reader (fail closed)", async () => {
    await loadSchedulingRuleBook(m.client, T0);
    await m.client.schedulingRuleVersion.update({ where: { version: 1 }, data: { values: { ...(canonicalRuleValues((await loadSchedulingRuleBook(m.client, T0)).live.values)), "laundry.maxOutdoorDays": 5 } } });
    await expect(loadSchedulingRuleBook(m.client, T0)).rejects.toBeInstanceOf(SchedulingRulesUnavailableError);
  });
});
