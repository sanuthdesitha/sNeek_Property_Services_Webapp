// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), verify: vi.fn(), create: vi.fn(), rotate: vi.fn(), revoke: vi.fn(), pause: vi.fn(), list: vi.fn(), grantable: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/security/admin-verification", async (original) => ({ ...(await original<typeof import("@/lib/security/admin-verification")>()), verifySensitiveAction: m.verify }));
vi.mock("@/lib/agents/admin", async (original) => ({ ...(await original<typeof import("@/lib/agents/admin")>()), createAgent: m.create, rotateAgentToken: m.rotate, revokeAgent: m.revoke, setAgentsPaused: m.pause, listAgents: m.list }));
vi.mock("@/lib/agents/access", async (original) => ({ ...(await original<typeof import("@/lib/agents/access")>()), readableScopesFor: m.grantable }));
import { GET, POST } from "@/app/api/admin/agents/route";
import { POST as AGENT_POST } from "@/app/api/admin/agents/[id]/route";
import { AgentAdminError } from "@/lib/agents/admin";
import { SensitiveVerificationError } from "@/lib/security/admin-verification";

const admin = { user: { id: "admin-1", role: "ADMIN" } };
const post = (body: unknown) => new Request("https://estate.example/api/admin/agents", { method: "POST", body: JSON.stringify(body) });
const create = { action: "create", name: "Hermes", areas: ["jobs"], expiresInDays: 30, credentials: { pin: "1234" } };
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue(admin); m.verify.mockResolvedValue(true); m.list.mockResolvedValue({ paused: false, agents: [] }); m.grantable.mockResolvedValue(["jobs"]);
  m.create.mockResolvedValue({ agentId: "agent-1", token: "snk_agent_shown_once", prefix: "snk_agent_shown", expiresAt: "2026-12-14T00:00:00.000Z" });
});

it("lists agents with the real MCP address for administrators only", async () => {
  const response = await GET(new Request("https://estate.example/api/admin/agents"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ mcpUrl: expect.stringMatching(/\/api\/agent\/mcp$/), grantable: ["jobs"] });
  expect(m.role).toHaveBeenCalledWith(["ADMIN"]);
  m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await GET(new Request("https://estate.example/api/admin/agents"))).status).toBe(403);
});

it("creates only after the administrator's own PIN and returns the token once", async () => {
  const response = await POST(post(create));
  expect(response.status).toBe(201);
  expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "1234" });
  expect(m.create).toHaveBeenCalledWith({ name: "Hermes", areas: ["jobs"], expiresInDays: 30 }, "admin-1");
  expect((await response.json()).token).toBe("snk_agent_shown_once");
});

it("refuses a wrong or missing PIN (423), impersonation and non-administrators (403) without changing anything", async () => {
  m.verify.mockRejectedValueOnce(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION" as never));
  expect((await POST(post(create))).status).toBe(423);
  m.role.mockResolvedValueOnce({ ...admin, impersonation: { actorId: "admin-1", mode: "FULL" } });
  expect((await POST(post(create))).status).toBe(403);
  m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await POST(post(create))).status).toBe(403);
  expect(m.create).not.toHaveBeenCalled();
});

it("refuses access wider than the creator's own (403 from the service)", async () => {
  m.create.mockRejectedValueOnce(new AgentAdminError(403, "You cannot give an agent access you do not have: finance."));
  const response = await POST(post({ ...create, areas: ["finance"] }));
  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("finance");
});

it("rotates, revokes and pauses with the PIN", async () => {
  m.rotate.mockResolvedValue({ token: "snk_agent_new", prefix: "snk_agent_new", expiresAt: "x" });
  expect((await AGENT_POST(post({ action: "rotate", expiresInDays: 7, credentials: { pin: "1234" } }), { params: { id: "agent-1" } })).status).toBe(200);
  expect(m.rotate).toHaveBeenCalledWith("agent-1", { expiresInDays: 7 }, "admin-1");
  expect((await AGENT_POST(post({ action: "revoke", credentials: { pin: "1234" } }), { params: { id: "agent-1" } })).status).toBe(200);
  expect(m.revoke).toHaveBeenCalledWith("agent-1", "admin-1");
  expect((await POST(post({ action: "pause", paused: true, credentials: { pin: "1234" } }))).status).toBe(200);
  expect(m.pause).toHaveBeenCalledWith(true, "admin-1");
  expect(m.verify).toHaveBeenCalledTimes(3);
});
