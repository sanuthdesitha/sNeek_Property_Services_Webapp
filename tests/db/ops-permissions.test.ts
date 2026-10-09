// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
import { getOpsPolicy, saveOpsPolicy, OPS_POLICY_KEY } from "@/lib/rbac/ops-access";
import { EMPTY_OPS_POLICY, resolveOpsLevels } from "@/lib/rbac/ops-policy";
const url = process.env.SNEEK_TEST_DATABASE_URL;
const actor = `ops-permissions-${randomUUID()}`;
let original: any;
describe.skipIf(!url)("operations permission persistence", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated disposable database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    original = await m.client.appSetting.findUnique({ where: { key: OPS_POLICY_KEY } });
    await m.client.appSetting.deleteMany({ where: { key: OPS_POLICY_KEY } });
    await m.client.user.create({ data: { id: actor, email: `${actor}@example.invalid`, role: "ADMIN", passwordHash: "fixture-only" } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.appSetting.deleteMany({ where: { key: OPS_POLICY_KEY } });
    if (original) await m.client.appSetting.create({ data: original });
    await m.client.auditLog.deleteMany({ where: { userId: actor } });
    await m.client.user.delete({ where: { id: actor } });
    await m.client.$disconnect();
  });
  it("saves audited restrictions and rejects a concurrent stale writer atomically", async () => {
    expect(await getOpsPolicy()).toEqual(EMPTY_OPS_POLICY);
    const input = { ...EMPTY_OPS_POLICY, assignments: { manager: { presetId: "observer", overrides: { jobs: "off" as const } } } };
    const outcomes = await Promise.allSettled([saveOpsPolicy(actor, input), saveOpsPolicy(actor, input)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("OPS_POLICY_CONFLICT");
    const saved = await getOpsPolicy();
    expect(saved.revision).toBe(1);
    expect(resolveOpsLevels(saved, "manager").jobs).toBe("off");
    expect(await m.client.auditLog.count({ where: { userId: actor, action: "OPS_PERMISSIONS_UPDATED" } })).toBe(1);
    await m.client.appSetting.update({ where: { key: OPS_POLICY_KEY }, data: { value: { corrupt: true } } });
    await expect(getOpsPolicy()).rejects.toThrow();
  });
});
