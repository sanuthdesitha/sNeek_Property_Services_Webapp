// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ token: vi.fn(), user: vi.fn(), setting: vi.fn(), touch: vi.fn(), policy: vi.fn(), rate: vi.fn(), levels: { current: {} as Record<string, string> } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { agentToken: { findUnique: m.token, updateMany: m.touch }, user: { findUnique: m.user }, appSetting: { findUnique: m.setting } } }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: m.policy }));
vi.mock("@/lib/ai/provider/store", () => ({ reserveRateLimit: m.rate }));
// The person's resolved area levels (the real resolver is covered by the access tests).
vi.mock("@/lib/rbac/ops-policy", async (original) => ({ ...(await original<typeof import("@/lib/rbac/ops-policy")>()), resolveOpsLevels: () => m.levels.current }));
import { AGENT_TOKEN_PREFIX, authenticateAgent, effectiveAgentScopes, hashAgentToken, newAgentToken, readableScopesFor } from "@/lib/agents/access";
import { EMPTY_OPS_POLICY } from "@/lib/rbac/ops-policy";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { AGENT_SCOPE_KEYS } from "@/lib/agents/scopes";

const now = new Date("2026-11-14T03:00:00Z");
const admin = { id: "admin-1", isActive: true, role: "ADMIN", extraRoles: [] };
function tokenRow(patch: Record<string, unknown> = {}, agentPatch: Record<string, unknown> = {}) {
  return { id: "tok-1", agentId: "agent-1", revokedAt: null, expiresAt: new Date("2026-12-01T00:00:00Z"), lastUsedAt: null, agent: { id: "agent-1", name: "Hermes", status: "ACTIVE", createdById: "admin-1", areas: ["jobs", "finance"], ...agentPatch }, ...patch };
}
/** An OPS manager's current area levels (everything else off). */
function opsPolicy(levels: Record<string, "off" | "read" | "manage">) {
  m.levels.current = { ...allOpsLevels("off"), ...levels };
  return EMPTY_OPS_POLICY;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue(admin); m.setting.mockResolvedValue(null); m.rate.mockResolvedValue(true); m.touch.mockResolvedValue({ count: 1 });
  m.policy.mockResolvedValue(EMPTY_OPS_POLICY);
});

describe("agent tokens", () => {
  it("are random, prefixed, and stored only as a sha-256 hash", () => {
    const a = newAgentToken(); const b = newAgentToken();
    expect(a.token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashAgentToken(a.token)); expect(a.hash).toMatch(/^[0-9a-f]{64}$/); expect(a.hash).not.toContain(a.token);
    expect(a.token.length).toBeGreaterThan(50); expect(a.token.startsWith(a.prefix)).toBe(true); expect(a.prefix.length).toBeLessThan(20);
  });

  it("authenticates a live token by its hash and records last use", async () => {
    m.token.mockResolvedValue(tokenRow());
    const context = await authenticateAgent(`Bearer ${AGENT_TOKEN_PREFIX}abc`, now);
    expect(m.token).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashAgentToken(`${AGENT_TOKEN_PREFIX}abc`) } }));
    expect(context).toMatchObject({ agentId: "agent-1", scopes: ["jobs", "finance"], withheld: [] });
    expect(m.touch).toHaveBeenCalledWith({ where: { id: "tok-1" }, data: { lastUsedAt: now } });
  });

  it.each([
    ["missing header", null, () => undefined, "MISSING_TOKEN", 401],
    ["not an agent token", "Bearer something-else", () => undefined, "INVALID_TOKEN", 401],
    ["unknown token", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => m.token.mockResolvedValue(null), "INVALID_TOKEN", 401],
    ["revoked token", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => m.token.mockResolvedValue(tokenRow({ revokedAt: new Date() })), "REVOKED", 401],
    ["revoked agent", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => m.token.mockResolvedValue(tokenRow({}, { status: "REVOKED" })), "REVOKED", 401],
    ["expired token", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => m.token.mockResolvedValue(tokenRow({ expiresAt: now })), "EXPIRED", 401],
    ["global pause", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => { m.token.mockResolvedValue(tokenRow()); m.setting.mockResolvedValue({ value: { paused: true } }); }, "AGENTS_PAUSED", 503],
    ["deactivated creator", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => { m.token.mockResolvedValue(tokenRow()); m.user.mockResolvedValue({ ...admin, isActive: false }); }, "CREATOR_INACTIVE", 403],
    ["minute limit", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => { m.token.mockResolvedValue(tokenRow()); m.rate.mockResolvedValueOnce(false); }, "RATE_LIMITED", 429],
    ["daily budget", `Bearer ${AGENT_TOKEN_PREFIX}x`, () => { m.token.mockResolvedValue(tokenRow()); m.rate.mockResolvedValueOnce(true).mockResolvedValueOnce(false); }, "DAILY_BUDGET", 429],
  ])("refuses a %s", async (_label, header, arrange, code, status) => {
    arrange();
    await expect(authenticateAgent(header as string | null, now)).rejects.toMatchObject({ code, status });
    expect(m.touch).not.toHaveBeenCalled();
  });

  it("uses per-token limit keys shared through RateLimitWindow", async () => {
    m.token.mockResolvedValue(tokenRow());
    await authenticateAgent(`Bearer ${AGENT_TOKEN_PREFIX}x`, now);
    expect(m.rate.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([["agent-token:tok-1:minute", 60, 60_000], ["agent-token:tok-1:day", 5000, 86_400_000]]);
  });
});

describe("an agent never exceeds its creator", () => {
  it("an active administrator can read every pack; nobody else without office access", async () => {
    expect(await readableScopesFor("admin-1")).toEqual([...AGENT_SCOPE_KEYS]);
    m.user.mockResolvedValue({ id: "c1", isActive: true, role: "CLEANER", extraRoles: [] });
    expect(await readableScopesFor("c1")).toEqual([]);
    m.user.mockResolvedValue(null);
    expect(await readableScopesFor("gone")).toEqual([]);
  });

  it("an operations manager gets only areas at read or above, and finance only with the invoices capability", async () => {
    m.user.mockResolvedValue({ id: "ops-1", isActive: true, role: "OPS_MANAGER", extraRoles: [] });
    m.policy.mockResolvedValue(opsPolicy({ jobs: "read", laundry: "manage", finance: "off" }));
    expect(await readableScopesFor("ops-1")).toEqual(["jobs", "laundry"]);
  });

  it("withholds packs as soon as the creator loses them, and everything when the creator is disabled or demoted", async () => {
    const agent = { areas: ["jobs", "laundry", "stock"], createdById: "ops-1" };
    m.user.mockResolvedValue({ id: "ops-1", isActive: true, role: "OPS_MANAGER", extraRoles: [] });
    m.policy.mockResolvedValue(opsPolicy({ jobs: "read", laundry: "read", inventory: "read" }));
    expect(await effectiveAgentScopes(agent)).toEqual({ effective: ["jobs", "laundry", "stock"], withheld: [] });
    m.policy.mockResolvedValue(opsPolicy({ jobs: "read", laundry: "off", inventory: "read" }));
    expect(await effectiveAgentScopes(agent)).toEqual({ effective: ["jobs", "stock"], withheld: ["laundry"] });
    m.user.mockResolvedValue({ id: "ops-1", isActive: false, role: "OPS_MANAGER", extraRoles: [] });
    expect(await effectiveAgentScopes(agent)).toEqual({ effective: [], withheld: ["jobs", "laundry", "stock"] });
    m.user.mockResolvedValue({ id: "ops-1", isActive: true, role: "CLEANER", extraRoles: [] });
    expect((await effectiveAgentScopes(agent)).effective).toEqual([]);
  });

  it("ignores pack names that are not agent scopes", async () => {
    expect(await effectiveAgentScopes({ areas: ["jobs", "settings", "admin"], createdById: "admin-1" })).toEqual({ effective: ["jobs"], withheld: [] });
  });
});
