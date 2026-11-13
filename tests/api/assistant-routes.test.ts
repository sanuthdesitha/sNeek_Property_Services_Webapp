// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), ask: vi.fn(), reply: vi.fn(), notes: vi.fn(), explain: vi.fn(), can: vi.fn(), policy: vi.fn(), assignment: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/assistant/ask", () => ({ askOperations: m.ask }));
vi.mock("@/lib/assistant/explain-and-draft", async (original) => ({ ...(await original<typeof import("@/lib/assistant/explain-and-draft")>()), draftClientReply: m.reply, draftQuoteNotes: m.notes, explainFlag: m.explain }));
vi.mock("@/lib/rbac/can", () => ({ can: m.can }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: m.policy }));
vi.mock("@/lib/db", () => ({ db: { qaAssignment: { findFirst: m.assignment } } }));
// This operations manager's live access has Quotes off.
vi.mock("@/lib/rbac/ops-policy", async (original) => ({ ...(await original<typeof import("@/lib/rbac/ops-policy")>()), resolveOpsLevels: () => ({ quotes: "off" }) }));
import { POST as ASK } from "@/app/api/admin/assistant/ask/route";
import { POST as DRAFT } from "@/app/api/admin/assistant/draft/route";
import { POST as EXPLAIN } from "@/app/api/qa/jobs/[id]/photo-review/explain/route";
import { EMPTY_OPS_POLICY } from "@/lib/rbac/ops-policy";

const post = (body: unknown) => new Request("http://local", { method: "POST", body: JSON.stringify(body) });
const admin = { user: { id: "admin-1", name: "Owner", role: "ADMIN", heldRoles: ["ADMIN"] } };
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue(admin); m.can.mockResolvedValue(true); m.policy.mockResolvedValue(EMPTY_OPS_POLICY);
  m.ask.mockResolvedValue({ state: "unavailable", reason: "No AI provider is configured for Ask (Settings, AI)." });
  m.reply.mockResolvedValue({ state: "drafted", draft: "Hi" }); m.notes.mockResolvedValue({ state: "drafted", draft: "Notes" }); m.explain.mockResolvedValue({ state: "explained", explanation: "x", whatToCheck: [] });
});

it("Ask answers as the signed-in person, reports unavailable as 200 and refuses while testing as someone", async () => {
  const response = await ASK(post({ question: "Jobs today?" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "unavailable" });
  expect(m.ask).toHaveBeenCalledWith({ question: "Jobs today?", user: { id: "admin-1", name: "Owner" } });
  expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  m.role.mockResolvedValueOnce({ ...admin, impersonation: { actorId: "admin-1", mode: "READ_ONLY" } });
  expect((await ASK(post({ question: "Jobs today?" }))).status).toBe(403);
  expect((await ASK(post({ question: "x" }))).status).toBe(400);
});

it("drafts need message or quote read access and never call a send", async () => {
  expect((await DRAFT(post({ kind: "client_reply", clientId: "c1", intent: "thanks" }))).status).toBe(200);
  expect(m.reply).toHaveBeenCalledWith({ clientId: "c1", intent: "thanks", actor: { kind: "user", userId: "admin-1" } });
  m.can.mockResolvedValueOnce(false);
  expect((await DRAFT(post({ kind: "client_reply", clientId: "c1" }))).status).toBe(403);
  m.role.mockResolvedValue({ user: { id: "ops-1", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
  expect((await DRAFT(post({ kind: "quote_notes", quoteId: "q1" }))).status).toBe(403);
  expect(m.notes).not.toHaveBeenCalled();
});

it("Explain this flag keeps photo-review access: inspectors only on assigned jobs", async () => {
  m.role.mockResolvedValue({ user: { id: "qa-1", role: "QA_INSPECTOR", heldRoles: ["QA_INSPECTOR"] } });
  m.assignment.mockResolvedValueOnce(null);
  expect((await EXPLAIN(post({ kind: "finding", id: "m1:0" }), { params: { id: "job-1" } })).status).toBe(403);
  expect(m.explain).not.toHaveBeenCalled();
  m.assignment.mockResolvedValueOnce({ id: "a1" });
  expect((await EXPLAIN(post({ kind: "finding", id: "m1:0" }), { params: { id: "job-1" } })).status).toBe(200);
  expect(m.explain).toHaveBeenCalledWith({ jobId: "job-1", kind: "finding", id: "m1:0", actor: { kind: "user", userId: "qa-1" } });
});
