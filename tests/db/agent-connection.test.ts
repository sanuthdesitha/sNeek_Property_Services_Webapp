// @vitest-environment node
/**
 * Agent connection on a real, disposable PostgreSQL (127.0.0.1:55439):
 * create, authenticate, rotate, revoke, expiry, creator deactivated, the
 * shared per-token limit, the append-only request audit and the admin audit.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { createAgent, revokeAgent, rotateAgentToken, setAgentsPaused } from "@/lib/agents/admin";
import { authenticateAgent } from "@/lib/agents/access";
import { handleMcpPost } from "@/lib/agents/mcp";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const admin = `agent-admin-${randomUUID()}`;
let paused: unknown = undefined;

describe.skipIf(!url)("agent connection (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    paused = (await m.client.appSetting.findUnique({ where: { key: "agents_paused_v1" } }))?.value;
    await m.client.appSetting.deleteMany({ where: { key: "agents_paused_v1" } });
    await m.client.user.create({ data: { id: admin, name: "Fixture Admin", email: `${admin}@example.invalid`, role: "ADMIN", passwordHash: "fixture-only" } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.agentProfile.deleteMany({ where: { createdById: admin } });
    await m.client.auditLog.deleteMany({ where: { userId: admin } });
    await m.client.user.deleteMany({ where: { id: admin } });
    await m.client.appSetting.deleteMany({ where: { key: "agents_paused_v1" } });
    if (paused !== undefined) await m.client.appSetting.create({ data: { key: "agents_paused_v1", value: paused as never } });
    await m.client.$disconnect();
  });

  it("issues a token that works once stored only as a hash; rotation and revocation take effect at once", async () => {
    const created = await createAgent({ name: "Hermes", areas: ["jobs", "laundry"], expiresInDays: 30 }, admin);
    const stored = await m.client.agentToken.findMany({ where: { agentId: created.agentId } });
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(await authenticateAgent(`Bearer ${created.token}`)).toMatchObject({ agentId: created.agentId, scopes: ["jobs", "laundry"] });
    expect((await m.client.agentToken.findFirst({ where: { agentId: created.agentId } }))?.lastUsedAt).not.toBeNull();

    const rotated = await rotateAgentToken(created.agentId, { expiresInDays: 7 }, admin);
    await expect(authenticateAgent(`Bearer ${created.token}`)).rejects.toMatchObject({ code: "REVOKED" });
    await expect(authenticateAgent(`Bearer ${rotated.token}`)).resolves.toMatchObject({ agentId: created.agentId });

    await revokeAgent(created.agentId, admin);
    await expect(authenticateAgent(`Bearer ${rotated.token}`)).rejects.toMatchObject({ code: "REVOKED" });
    const actions = (await m.client.auditLog.findMany({ where: { userId: admin, entityId: created.agentId }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["AGENT_CREATED", "AGENT_TOKEN_ROTATED", "AGENT_REVOKED"]);
    expect(JSON.stringify(await m.client.auditLog.findMany({ where: { userId: admin } }))).not.toContain(rotated.token);
  });

  it("refuses expired tokens, a paused service and a deactivated creator", async () => {
    const created = await createAgent({ name: "Claude", areas: ["jobs"], expiresInDays: 1 }, admin);
    await expect(authenticateAgent(`Bearer ${created.token}`, new Date(Date.now() + 2 * 86_400_000))).rejects.toMatchObject({ code: "EXPIRED" });
    await setAgentsPaused(true, admin);
    await expect(authenticateAgent(`Bearer ${created.token}`)).rejects.toMatchObject({ code: "AGENTS_PAUSED" });
    await setAgentsPaused(false, admin);
    await m.client.user.update({ where: { id: admin }, data: { isActive: false } });
    await expect(authenticateAgent(`Bearer ${created.token}`)).rejects.toMatchObject({ code: "CREATOR_INACTIVE" });
    await m.client.user.update({ where: { id: admin }, data: { isActive: true } });
  });

  it("enforces the per-minute limit through RateLimitWindow and audits every request append-only", async () => {
    const created = await createAgent({ name: "Burst", areas: ["jobs"], expiresInDays: 1 }, admin);
    const at = new Date();
    const results = await Promise.allSettled(Array.from({ length: 65 }, () => authenticateAgent(`Bearer ${created.token}`, at)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(60);
    expect(results.filter((result) => result.status === "rejected" && (result.reason as { code: string }).code === "RATE_LIMITED")).toHaveLength(5);
    await m.client.rateLimitWindow.deleteMany({ where: { key: { startsWith: "agent-token:" } } });

    const other = await createAgent({ name: "Auditor", areas: ["jobs"], expiresInDays: 1 }, admin);
    const reply = await handleMcpPost({ authorization: `Bearer ${other.token}`, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } } });
    expect(reply.status).toBe(200);
    const rows = await m.client.agentAuditEntry.findMany({ where: { agentId: other.agentId } });
    expect(rows).toEqual([expect.objectContaining({ method: "tools/call", tool: "whoami", outcome: "OK", creatorId: admin })]);
    await expect(m.client.agentAuditEntry.update({ where: { id: rows[0].id }, data: { outcome: "X" } })).rejects.toThrow();
  });
});
