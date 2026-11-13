// @vitest-environment node
/**
 * Agent actions (step 6), without a database: write packs capped by the
 * creator's live MANAGE access, write tools that only create requests (and
 * never reach the executor), the status tool, and the import boundary that
 * keeps the MCP server away from execution.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/access";

const m = vi.hoisted(() => ({
  user: vi.fn(), policy: vi.fn(), setting: vi.fn(), auth: vi.fn(), audit: vi.fn(),
  issue: vi.fn(), requestFind: vi.fn(), requestFindFirst: vi.fn(), requestCreate: vi.fn(), eventCreate: vi.fn(), notice: vi.fn(),
  reschedule: vi.fn(), addComment: vi.fn(), createCase: vi.fn(), actOnStock: vi.fn(),
  levels: { current: {} as Record<string, string> },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: m.policy, getOpsAccess: async () => m.levels.current }));
vi.mock("@/lib/rbac/ops-policy", async (original) => ({ ...(await original<typeof import("@/lib/rbac/ops-policy")>()), resolveOpsLevels: () => m.levels.current }));
vi.mock("@/lib/agents/access", async (original) => ({ ...(await original<typeof import("@/lib/agents/access")>()), authenticateAgent: m.auth }));
vi.mock("@/lib/notifications/agent-requests", () => ({ sendAgentRequestNotice: m.notice }));
// The domain services an approval would run: an agent call must never reach them.
vi.mock("@/lib/phase4/analytics", () => ({ applyReschedule: m.reschedule, rescheduleWindowError: () => null }));
vi.mock("@/lib/cases/service", () => ({ addCaseComment: m.addComment, createCase: m.createCase }));
vi.mock("@/lib/inventory/urgent-stock", () => ({ actOnUrgentStock: m.actOnStock, urgentStockOfficeAllowed: async () => true }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findUnique: m.user },
  appSetting: { findUnique: m.setting },
  agentAuditEntry: { create: m.audit },
  issueTicket: { findUnique: m.issue },
  agentActionRequest: { findUnique: m.requestFind, findFirst: m.requestFindFirst },
  $transaction: async (run: (tx: unknown) => unknown) => run({ agentActionRequest: { create: m.requestCreate }, agentActionEvent: { create: m.eventCreate } }),
} }));
import { effectiveAgentWriteScopes, manageableWriteScopesFor } from "@/lib/agents/access";
import { handleMcpPost } from "@/lib/agents/mcp";
import { toolsFor } from "@/lib/agents/tools";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { EMPTY_OPS_POLICY } from "@/lib/rbac/ops-policy";
import { AGENT_WRITE_SCOPE_KEYS, type AgentWriteScopeKey } from "@/lib/agents/write-scopes";
import { AGENT_SCOPE_KEYS } from "@/lib/agents/scopes";
import { canonicalJson } from "@/lib/agents/action-catalog";

const admin = { id: "admin-1", isActive: true, role: "ADMIN", extraRoles: [] };
const manager = { id: "ops-1", isActive: true, role: "OPS_MANAGER", extraRoles: [] };
function levels(current: Record<string, "off" | "read" | "manage">) {
  m.levels.current = { ...allOpsLevels("off"), ...current };
}
function context(writeScopes: AgentWriteScopeKey[]): AgentContext {
  return { agentId: "agent-1", agentName: "Hermes", tokenId: "tok-1", creatorId: "admin-1", expiresAt: new Date("2026-12-01T00:00:00Z"), scopes: [...AGENT_SCOPE_KEYS], withheld: [], writeScopes, writeWithheld: [] };
}
const call = (name: string, args: Record<string, unknown>) => handleMcpPost({ authorization: "Bearer snk_agent_x", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } }) as Promise<{ body: { result: { isError: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> } } }>;
const issue = { id: "case-1", title: "Broken lamp", state: "OPEN", updatedAt: new Date("2026-11-13T00:00:00Z"), job: null, property: { name: "Beach House" } };

beforeEach(() => {
  vi.resetAllMocks();
  m.policy.mockResolvedValue(EMPTY_OPS_POLICY);
  m.user.mockResolvedValue(admin);
  m.setting.mockResolvedValue(null);
  m.audit.mockResolvedValue({});
  m.issue.mockResolvedValue(issue);
  m.requestFind.mockResolvedValue(null);
  m.requestCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "req-1", status: "WAITING", createdAt: new Date(), decidedAt: null, decisionReason: null, result: null, error: null }));
  m.eventCreate.mockResolvedValue({});
  m.notice.mockResolvedValue([{ state: "inbox_available" }, { state: "skipped" }]);
  levels({});
});

describe("write packs are capped by the creator's live MANAGE access", () => {
  it("an administrator can hand out every pack", async () => {
    expect(await manageableWriteScopesFor("admin-1")).toEqual([...AGENT_WRITE_SCOPE_KEYS]);
  });

  it("an operations manager only packs whose every area is at manage; read is not enough", async () => {
    m.user.mockResolvedValue(manager);
    levels({ jobs: "manage", calendar: "read", cases: "manage", inventory: "read" });
    expect(await manageableWriteScopesFor("ops-1")).toEqual(["cases_write"]);
    levels({ jobs: "manage", calendar: "manage", cases: "off", inventory: "manage" });
    expect(await manageableWriteScopesFor("ops-1")).toEqual(["jobs_reschedule", "stock_acknowledge"]);
  });

  it("an agent loses a pack as soon as its creator can no longer manage the area; a deactivated creator gives none", async () => {
    m.user.mockResolvedValue(manager);
    levels({ cases: "manage", jobs: "manage", calendar: "read" });
    expect(await effectiveAgentWriteScopes({ writeAreas: ["jobs_reschedule", "cases_write", "not-a-pack"], createdById: "ops-1" })).toEqual({ effective: ["cases_write"], withheld: ["jobs_reschedule"] });
    m.user.mockResolvedValue({ ...manager, isActive: false });
    expect(await effectiveAgentWriteScopes({ writeAreas: ["cases_write"], createdById: "ops-1" })).toEqual({ effective: [], withheld: ["cases_write"] });
    expect(await effectiveAgentWriteScopes({ writeAreas: [], createdById: "ops-1" })).toEqual({ effective: [], withheld: [] });
  });
});

describe("write tools only ask", () => {
  it("are listed only with their write pack, and are not marked read-only", async () => {
    expect(toolsFor(context([])).some((tool) => tool.kind === "write")).toBe(false);
    expect(toolsFor(context(["cases_write"])).filter((tool) => tool.kind === "write").map((tool) => tool.name)).toEqual(["request_case_note", "request_create_case"]);
    m.auth.mockResolvedValue(context(["cases_write"]));
    const list = await handleMcpPost({ authorization: "Bearer x", body: { jsonrpc: "2.0", id: 2, method: "tools/list" } }) as { body: { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } } };
    const write = list.body.result.tools.find((tool) => tool.name === "request_case_note");
    expect(write?.annotations.readOnlyHint).toBe(false);
    expect(list.body.result.tools.find((tool) => tool.name === "get_action_request")?.annotations.readOnlyHint).toBe(true);
  });

  it("creates a WAITING request with the preview and never runs a domain service", async () => {
    m.auth.mockResolvedValue(context(["cases_write"]));
    const result = await call("request_case_note", { caseId: "case-1", note: "Guest reported a broken lamp", idempotencyKey: "hermes-0001" });
    expect(result.body.result.isError).toBe(false);
    expect(result.body.result.structuredContent).toMatchObject({ requestId: "req-1", status: "WAITING", summary: expect.stringContaining("Broken lamp"), approversNotified: 1 });
    expect(m.requestCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "WAITING", tool: "request_case_note", area: "cases_write", idempotencyKey: "hermes-0001", arguments: { caseId: "case-1", note: "Guest reported a broken lamp" } }) });
    expect(m.eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "CREATED", toStatus: "WAITING", actorId: null }) });
    for (const service of [m.reschedule, m.addComment, m.createCase, m.actOnStock]) expect(service).not.toHaveBeenCalled();
  });

  it("returns the earlier request for a repeated key (arguments compared whatever the stored key order) and refuses other arguments", async () => {
    m.auth.mockResolvedValue(context(["cases_write"]));
    m.requestFind.mockResolvedValue({ id: "req-0", tool: "request_case_note", status: "WAITING", arguments: { note: "Same", caseId: "case-1" }, preview: { summary: "Add a note", details: [], effects: [] }, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000), decidedAt: null, decisionReason: null, result: null, error: null });
    const again = await call("request_case_note", { caseId: "case-1", note: "Same", idempotencyKey: "hermes-0002" });
    expect(again.body.result.structuredContent).toMatchObject({ requestId: "req-0", repeated: true });
    const other = await call("request_case_note", { caseId: "case-1", note: "Different", idempotencyKey: "hermes-0002" });
    expect(other.body.result.isError).toBe(true);
    expect(other.body.result.content[0].text).toMatch(/already used for a different request/);
    expect(m.requestCreate).not.toHaveBeenCalled();
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("is refused without the pack, while paused, without a key, or when the dry run fails; nothing is stored", async () => {
    m.auth.mockResolvedValue(context([]));
    expect((await call("request_case_note", { caseId: "case-1", note: "x", idempotencyKey: "hermes-0003" })).body.result.content[0].text).toMatch(/cannot use request_case_note/);
    m.auth.mockResolvedValue(context(["cases_write"]));
    expect((await call("request_case_note", { caseId: "case-1", note: "x" })).body.result.content[0].text).toMatch(/idempotencyKey/);
    m.setting.mockResolvedValue({ value: { paused: true } });
    expect((await call("request_case_note", { caseId: "case-1", note: "x", idempotencyKey: "hermes-0004" })).body.result.content[0].text).toMatch(/paused/);
    m.setting.mockResolvedValue(null);
    m.issue.mockResolvedValue(null);
    expect((await call("request_case_note", { caseId: "nope", note: "x", idempotencyKey: "hermes-0005" })).body.result.content[0].text).toMatch(/No case with that id/);
    expect((await call("request_create_case", { title: "Flood", caseType: "DAMAGE", idempotencyKey: "hermes-0006" })).body.result.isError).toBe(true);
    expect(m.requestCreate).not.toHaveBeenCalled();
  });

  it("reports only this agent's own requests through get_action_request (offered only to agents that can ask)", async () => {
    expect(toolsFor(context([])).some((tool) => tool.name === "get_action_request")).toBe(false);
    expect(toolsFor({ ...context([]), writeWithheld: ["cases_write"] }).some((tool) => tool.name === "get_action_request")).toBe(true);
    m.auth.mockResolvedValue(context(["cases_write"]));
    m.requestFindFirst.mockResolvedValue(null);
    const missing = await call("get_action_request", { requestId: "someone-elses" });
    expect(m.requestFindFirst).toHaveBeenCalledWith({ where: { id: "someone-elses", agentId: "agent-1" } });
    expect(missing.body.result.isError).toBe(true);
    m.requestFindFirst.mockResolvedValue({ id: "req-9", tool: "request_case_note", status: "WAITING", arguments: {}, preview: { summary: "Add a note", details: [], effects: [] }, createdAt: new Date("2026-11-10T00:00:00Z"), expiresAt: new Date("2026-11-11T00:00:00Z"), decidedAt: null, decisionReason: null, result: null, error: null });
    const lapsed = await call("get_action_request", { requestId: "req-9" });
    expect(lapsed.body.result.structuredContent).toMatchObject({ status: "EXPIRED" });
  });
});

describe("there is no code path from an MCP call to execution", () => {
  const root = process.cwd();
  function resolveImport(from: string, specifier: string): string | null {
    const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    return null;
  }
  function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [path.join(root, entry)];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of Array.from(source.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g))) {
        const next = resolveImport(file, match[1] ?? match[2]);
        if (next) queue.push(next);
      }
    }
    return new Set(Array.from(seen, (file) => path.relative(root, file).split(path.sep).join("/")));
  }

  it("the MCP route and server never import the executor or the approval route", () => {
    const graph = reachable("app/api/agent/mcp/route.ts");
    expect(graph.has("lib/agents/mcp.ts")).toBe(true);
    expect(graph.has("lib/agents/action-requests.ts")).toBe(true);
    expect(graph.has("lib/agents/action-execute.ts")).toBe(false);
    expect(graph.has("lib/agents/action-admin.ts")).toBe(false);
    expect(Array.from(graph).some((file) => file.startsWith("app/api/admin/agent-requests"))).toBe(false);
  });

  it("only the approval side imports the executor", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const relative = `${dir}/${name}`;
        if (statSync(path.join(root, relative)).isDirectory()) { if (name !== "node_modules" && !name.startsWith(".")) walk(relative); continue; }
        if (/\.(ts|tsx)$/.test(name) && /from\s+["'](?:@\/lib\/agents\/|\.\/)action-execute["']/.test(readFileSync(path.join(root, relative), "utf8"))) importers.push(relative);
      }
    };
    ["app", "lib", "workers", "components"].forEach(walk);
    expect(importers.sort()).toEqual(["app/api/admin/agent-requests/[id]/route.ts", "lib/agents/action-admin.ts", "lib/agents/action-http.ts"]);
  });
});
