// @vitest-environment node
/** Pilot features on PostgreSQL: saved state, audit with the actual actor, cache cleared, Off again. */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(m.client) : value; } }),
}));

import { PILOT_SETTING_KEY, isPilotOn, loadPilotState, savePilotSetting } from "@/lib/pilots/state";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const admin = `pilot-${randomUUID().slice(0, 8)}`;

describe.skipIf(!url)("pilot features (PostgreSQL)", () => {
  let before: { value: unknown } | null = null;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    before = await m.client.appSetting.findUnique({ where: { key: PILOT_SETTING_KEY } });
    await m.client.user.create({ data: { id: admin, email: `${admin}@example.invalid`, role: "ADMIN" } });
  });
  afterAll(async () => {
    if (!m.client) return;
    if (before) await m.client.appSetting.update({ where: { key: PILOT_SETTING_KEY }, data: { value: before.value as object } });
    else await m.client.appSetting.deleteMany({ where: { key: PILOT_SETTING_KEY } });
    await m.client.auditLog.deleteMany({ where: { userId: admin } });
    await m.client.user.deleteMany({ where: { id: admin } });
    await m.client.$disconnect();
  });

  it("is Off until saved, applies the saved scope at once, and is audited; Off again goes back", async () => {
    await m.client.appSetting.deleteMany({ where: { key: PILOT_SETTING_KEY } });
    expect(await isPilotOn("unused-check", { userId: "cleaner-a" })).toBe(false);
    const saved = await savePilotSetting({ id: admin, role: "ADMIN" }, { key: "unused-check", mode: "SCOPED", userIds: ["cleaner-a", "cleaner-a"], propertyIds: [] });
    expect(saved).toMatchObject({ mode: "SCOPED", userIds: ["cleaner-a"], changedById: admin });
    expect(saved.onSince).toBeTruthy();
    expect(await isPilotOn("unused-check", { userId: "cleaner-a" })).toBe(true);
    expect(await isPilotOn("unused-check", { userId: "cleaner-b" })).toBe(false);
    expect(await isPilotOn("property-reminders", { userId: "cleaner-a" })).toBe(false);
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { userId: admin, action: "PILOT_FEATURE_CHANGED", entityId: "unused-check" } });
    expect(audit.after).toMatchObject({ mode: "SCOPED", actorRole: "ADMIN" });
    await savePilotSetting({ id: admin, role: "ADMIN" }, { key: "unused-check", mode: "OFF", userIds: [], propertyIds: [] });
    expect(await isPilotOn("unused-check", { userId: "cleaner-a" })).toBe(false);
    expect((await loadPilotState()).pilots["unused-check"]).toMatchObject({ mode: "OFF", onSince: null });
  });
});
