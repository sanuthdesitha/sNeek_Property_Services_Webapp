// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_target, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }),
}));
import { getOpsPolicy, saveOpsPolicy, getOpsGrants, OPS_POLICY_KEY } from "@/lib/rbac/ops-access";
import { accessHistory } from "@/lib/rbac/access-directory";
import { evaluateCapability } from "@/lib/rbac/access-evaluator";
import { EMPTY_OPS_POLICY, resolveOpsLevels, type OpsPolicy } from "@/lib/rbac/ops-policy";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const admin = `access-admin-${randomUUID()}`;
const manager = `access-manager-${randomUUID()}`;
let original: { key: string; value: unknown } | null = null;

describe.skipIf(!url)("access and permissions persistence", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated disposable database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    original = await m.client.appSetting.findUnique({ where: { key: OPS_POLICY_KEY } }) as typeof original;
    await m.client.appSetting.deleteMany({ where: { key: OPS_POLICY_KEY } });
    await m.client.user.create({ data: { id: admin, name: "Fixture Admin", email: `${admin}@example.invalid`, role: "ADMIN", passwordHash: "fixture-only" } });
    await m.client.user.create({ data: { id: manager, name: "Fixture Manager", email: `${manager}@example.invalid`, role: "OPS_MANAGER", passwordHash: "fixture-only" } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.appSetting.deleteMany({ where: { key: OPS_POLICY_KEY } });
    if (original) await m.client.appSetting.create({ data: { key: original.key, value: original.value as object } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: [admin, manager] } } });
    await m.client.user.deleteMany({ where: { id: { in: [admin, manager] } } });
    await m.client.$disconnect();
  });

  it("saves Full, switches and a grant with an audit row naming the actor; next read applies them", async () => {
    const input: OpsPolicy = {
      ...EMPTY_OPS_POLICY,
      assignments: { [manager]: { presetId: "assistant-bookings", overrides: { jobs: "full", finance: "read" }, capabilities: { "jobs.cancel": false, "access.test_as": true } } },
    };
    const saved = await saveOpsPolicy(admin, input, { impersonatedBy: null, ipAddress: "127.0.0.1" });
    expect(saved.revision).toBe(1);
    const live = await getOpsPolicy();
    const subject = { id: manager, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };
    expect(resolveOpsLevels(live, manager).jobs).toBe("manage");
    expect(evaluateCapability(live, subject, "jobs.delete")).toBe(true);
    expect(evaluateCapability(live, subject, "jobs.cancel")).toBe(false);
    expect(await getOpsGrants(subject)).toEqual(["access.test_as"]);
    const row = await m.client.auditLog.findFirstOrThrow({ where: { userId: admin, action: "OPS_PERMISSIONS_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(row.before).toMatchObject({ revision: 0 });
    expect(row.after).toMatchObject({ revision: 1, audit: { actorId: admin, actorRole: "ADMIN", impersonatedBy: null } });
    expect(row.ipAddress).toBe("127.0.0.1");
    const history = await accessHistory();
    expect(history.filter((entry) => entry.subjectId === manager).map((entry) => entry.text)).toEqual(
      expect.arrayContaining(["Started from Assistant: bookings (was Existing ops access)", "Jobs and assignments: Manage → Full", "Switched off: Cancel jobs"]),
    );
  });

  it("refuses a stale revision and a change to the actor's own access, writing nothing", async () => {
    const stale = { ...EMPTY_OPS_POLICY, revision: 0 };
    await expect(saveOpsPolicy(admin, stale)).rejects.toThrow("OPS_POLICY_CONFLICT");
    const current = await getOpsPolicy();
    const selfChange: OpsPolicy = { ...current, assignments: { ...current.assignments, [manager]: { presetId: "existing", overrides: {} } } };
    await expect(saveOpsPolicy(manager, selfChange)).rejects.toThrow("OPS_POLICY_SELF_CHANGE");
    expect((await getOpsPolicy()).revision).toBe(current.revision);
    expect(await m.client.auditLog.count({ where: { userId: manager } })).toBe(0);
  });
});
