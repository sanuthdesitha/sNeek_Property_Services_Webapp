// @vitest-environment node
/**
 * Reminder suggestions on PostgreSQL (item 9, slice C): rules that are off
 * propose one-off suggestions with their facts; approving creates an office
 * reminder (nothing before); a second decision creates nothing; a dismissed
 * suggestion is not proposed again for the same facts; a rule switched on
 * stops proposing; changed facts cannot be approved; the actual actor is audited.
 * Run with SNEEK_TEST_DATABASE_URL pointing at a migrated disposable database.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", accountability: { issueCategories: [] } }) }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));

import { decideSuggestions, listSuggestions } from "@/lib/properties/reminders/suggestions";
import { RULE_SETTING_KEY } from "@/lib/properties/reminders/rules-load";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `rsg-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const admin = { id: id("admin"), role: "ADMIN" as const };
const ops = { id: id("ops"), role: "OPS_MANAGER" as const };

async function mine() {
  const payload = await listSuggestions(admin);
  return payload.suggestions.filter((row) => row.propertyId === id("property"));
}

describe.skipIf(!url)("reminder suggestions (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    await m.client.appSetting.deleteMany({ where: { key: RULE_SETTING_KEY } });
    await m.client.user.createMany({ data: [
      { id: id("admin"), email: `${id("admin")}@example.invalid`, role: "ADMIN", name: "Office Admin" },
      { id: id("ops"), email: `${id("ops")}@example.invalid`, role: "OPS_MANAGER", name: "Office Ops" },
    ] });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} client` } });
    await m.client.property.create({ data: { id: id("property"), clientId: id("client"), name: `${tag} Unit 4`, address: "1 Fixture Street", suburb: "Sydney" } });
    await m.client.propertyMaintenanceItem.createMany({ data: [
      { id: id("m1"), propertyId: id("property"), reportedByUserId: id("admin"), source: "ADMIN", title: "Oven door hinge loose", priority: "HIGH", status: "OPEN" },
      { id: id("m2"), propertyId: id("property"), reportedByUserId: id("admin"), source: "ADMIN", title: "Blind cord broken", priority: "LOW", status: "OPEN" },
      { id: id("m3"), propertyId: id("property"), reportedByUserId: id("admin"), source: "ADMIN", title: "Tap drips", priority: "LOW", status: "OPEN" },
    ] });
  });

  afterEach(async () => {
    await m.client.appSetting.deleteMany({ where: { key: RULE_SETTING_KEY } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: [id("admin"), id("ops")] } } });
    await m.client.reminderSuggestion.deleteMany({ where: { propertyId: id("property") } });
    await m.client.propertyReminder.deleteMany({ where: { propertyId: id("property") } });
    await m.client.propertyMaintenanceItem.deleteMany({ where: { propertyId: id("property") } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: { in: [id("admin"), id("ops")] } } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("proposes with facts; nothing reaches a cleaner until approved; decided once; dismissed never comes back", async () => {
    const rows = await mine();
    expect(rows.map((row) => row.text).sort()).toEqual([
      "Open maintenance: Blind cord broken. Work around it and report anything new.",
      "Open maintenance: Oven door hinge loose. Work around it and report anything new.",
      "Open maintenance: Tap drips. Work around it and report anything new.",
    ]);
    expect(rows.every((row) => row.stillCurrent && row.why.startsWith("Maintenance item reported"))).toBe(true);
    expect(await m.client.propertyReminder.count({ where: { propertyId: id("property") } })).toBe(0);

    const oven = rows.find((row) => row.text.includes("Oven"))!;
    const blind = rows.find((row) => row.text.includes("Blind"))!;
    const tap = rows.find((row) => row.text.includes("Tap"))!;
    // Two people approve the same suggestion at once: one reminder.
    const [first, second] = await Promise.all([decideSuggestions(ops, { action: "approve", ids: [oven.id] }), decideSuggestions(admin, { action: "approve", ids: [oven.id] })]);
    expect([first[0].outcome, second[0].outcome].sort()).toEqual(["ALREADY_DECIDED", "APPROVED"]);
    const reminders = await m.client.propertyReminder.findMany({ where: { propertyId: id("property") } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ origin: "SUGGESTION", lifetime: "NEXT_JOBS", jobsCount: 1, moment: "BEFORE_START" });
    expect(reminders[0].reason).toMatch(/^Maintenance item reported/);

    // Edit then approve; batch dismiss.
    await decideSuggestions(admin, { action: "approve", ids: [blind.id], edit: { text: "Do not pull the blind cord.", jobsCount: 3, mustConfirm: true } });
    expect(await m.client.propertyReminder.findFirst({ where: { propertyId: id("property"), text: "Do not pull the blind cord." } })).toMatchObject({ jobsCount: 3, mustConfirm: true });
    expect((await decideSuggestions(ops, { action: "dismiss", ids: [tap.id] }))[0].outcome).toBe("DISMISSED");
    expect(await mine()).toEqual([]);
    expect(await m.client.reminderSuggestion.count({ where: { propertyId: id("property") } })).toBe(3);

    const audits = await m.client.auditLog.findMany({ where: { entity: "ReminderSuggestion", userId: { in: [id("admin"), id("ops")] } } });
    expect(audits.map((row) => row.action).sort()).toEqual(["REMINDER_SUGGESTION_APPROVED", "REMINDER_SUGGESTION_APPROVED", "REMINDER_SUGGESTION_DISMISSED"]);
  });

  it("changed facts cannot be approved; a rule that is on stops proposing", async () => {
    const rows = await mine();
    await m.client.propertyMaintenanceItem.update({ where: { id: id("m1") }, data: { status: "RESOLVED" } });
    const oven = rows.find((row) => row.text.includes("Oven"))!;
    expect((await decideSuggestions(admin, { action: "approve", ids: [oven.id] }))[0].outcome).toBe("FACTS_CHANGED");
    expect((await mine()).find((row) => row.id === oven.id)?.stillCurrent).toBe(false);
    await m.client.appSetting.create({ data: { key: RULE_SETTING_KEY, value: { "open-maintenance": { enabled: true, changedAt: null, changedById: null } } } });
    expect(await mine()).toEqual([]);
  });
});
