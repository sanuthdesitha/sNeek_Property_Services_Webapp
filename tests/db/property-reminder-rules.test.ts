// @vitest-environment node
/**
 * Automatic reminder rules on PostgreSQL (item 9, slice B): off by default
 * nothing is made; switching on needs the preview the administrator saw and
 * is refused when the facts changed; once on, the job's reminders include
 * the rule's reminder with its facts; switching off removes it at once.
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

import { RULE_SETTING_KEY, loadRuleState, previewRule, saveRule } from "@/lib/properties/reminders/rules-load";
import { loadJobReminders } from "@/lib/properties/reminders/load";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `prr-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const admin = { id: id("admin"), role: "ADMIN" as const };

describe.skipIf(!url)("automatic reminder rules (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    await m.client.appSetting.deleteMany({ where: { key: RULE_SETTING_KEY } });
    await m.client.user.create({ data: { id: id("admin"), email: `${id("admin")}@example.invalid`, role: "ADMIN", name: "Office Admin" } });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} client` } });
    await m.client.property.create({ data: { id: id("property"), clientId: id("client"), name: `${tag} Unit 4`, address: "1 Fixture Street", suburb: "Sydney" } });
    await m.client.propertyMaintenanceItem.create({ data: { id: id("maint"), propertyId: id("property"), reportedByUserId: id("admin"), source: "ADMIN", title: "Oven door hinge loose", area: "Kitchen", priority: "HIGH", status: "OPEN" } });
  });

  afterEach(async () => {
    await m.client.appSetting.deleteMany({ where: { key: RULE_SETTING_KEY } });
    await m.client.auditLog.deleteMany({ where: { userId: id("admin") } });
    await m.client.propertyMaintenanceItem.deleteMany({ where: { propertyId: id("property") } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: id("admin") } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("off by default; on after the preview; off removes it", async () => {
    expect((await loadRuleState()).rules["open-maintenance"].enabled).toBe(false);
    expect(await loadJobReminders({ propertyId: id("property"), jobId: id("job"), userId: null })).toEqual([]);

    const preview = await previewRule("open-maintenance");
    expect(preview.reminders).toBeGreaterThanOrEqual(1);
    await expect(saveRule(admin, { rule: "open-maintenance", enabled: true, seen: null })).rejects.toMatchObject({ status: 409, code: "PREVIEW_CHANGED" });
    await expect(
      saveRule(admin, { rule: "open-maintenance", enabled: true, seen: { reminders: preview.reminders + 1, properties: preview.properties, cleaners: preview.cleaners } }),
    ).rejects.toMatchObject({ code: "PREVIEW_CHANGED", preview: expect.objectContaining({ reminders: preview.reminders }) });
    await saveRule(admin, { rule: "open-maintenance", enabled: true, seen: { reminders: preview.reminders, properties: preview.properties, cleaners: preview.cleaners } });

    const items = await loadJobReminders({ propertyId: id("property"), jobId: id("job"), userId: null });
    expect(items).toEqual([expect.objectContaining({ key: `rule:open-maintenance:${id("maint").replace(/[^A-Za-z0-9_-]/g, "_")}`, moment: "BEFORE_START", text: "Open maintenance: Oven door hinge loose (Kitchen). Work around it and report anything new." })]);
    expect(items[0].why).toMatch(/^Maintenance item reported \d+ \w+ \d{4}, priority high, status open\.$/);

    await m.client.propertyMaintenanceItem.update({ where: { id: id("maint") }, data: { status: "RESOLVED" } });
    expect(await loadJobReminders({ propertyId: id("property"), jobId: id("job"), userId: null })).toEqual([]);
    await m.client.propertyMaintenanceItem.update({ where: { id: id("maint") }, data: { status: "OPEN" } });

    await saveRule(admin, { rule: "open-maintenance", enabled: false });
    expect(await loadJobReminders({ propertyId: id("property"), jobId: id("job"), userId: null })).toEqual([]);
    const audits = await m.client.auditLog.findMany({ where: { entity: "PropertyReminderRule", userId: id("admin") }, orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => row.action)).toEqual(["PROPERTY_REMINDER_RULE_ON", "PROPERTY_REMINDER_RULE_OFF"]);
  });
});
