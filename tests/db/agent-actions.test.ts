// @vitest-environment node
/**
 * Agent actions (step 6) on a real, disposable PostgreSQL (127.0.0.1:55439):
 * idempotent requests, expiry, a stale entity at approval, approvers without
 * the permission, impersonation, the PIN where an action needs one, the
 * global pause, a withdrawn write pack, the executed paths through the
 * existing case service, and the database guards on the request history.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  notice: vi.fn(), caseUpdated: vi.fn(), caseCreated: vi.fn(), verify: vi.fn(), check: vi.fn(), reschedule: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/notifications/agent-requests", () => ({ sendAgentRequestNotice: m.notice }));
vi.mock("@/lib/cases/notifications", () => ({ notifyCaseUpdated: m.caseUpdated, notifyCaseCreated: m.caseCreated }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/calendar/check-move", () => ({ checkCalendarMove: m.check }));
vi.mock("@/lib/phase4/analytics", () => ({ applyReschedule: m.reschedule }));
import { createAgent, setAgentWriteAreas, setAgentsPaused } from "@/lib/agents/admin";
import { authenticateAgent, type AgentContext } from "@/lib/agents/access";
import { expireAgentRequests, proposeAgentAction } from "@/lib/agents/action-requests";
import { ACTION_EXECUTORS, AgentDecisionError, decideAgentRequest, decisionNeedsPin } from "@/lib/agents/action-execute";
import { AGENT_ACTION_TOOLS } from "@/lib/agents/action-catalog";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const admin = `aa-admin-${tag}`;
const opsCasesRead = `aa-ops-read-${tag}`;
const opsCasesManage = `aa-ops-manage-${tag}`;
const opsApprovalsRead = `aa-ops-appr-${tag}`;
const OPS_KEY = "ops_feature_permissions_v1";
const PAUSE_KEY = "agents_paused_v1";
let savedPolicy: unknown;
let savedPause: unknown;
let context: AgentContext;
let caseId: string;

const as = (userId: string, impersonating = false) => ({ userId, impersonating });
const key = () => `key-${randomUUID()}`;

async function fresh(): Promise<string> {
  const created = await m.client.issueTicket.create({ data: { title: `Fixture case ${tag}`, source: "FIXTURE" } });
  return created.id;
}
async function status(requestId: string) {
  return (await m.client.agentActionRequest.findUniqueOrThrow({ where: { id: requestId } })).status;
}
async function events(requestId: string) {
  return (await m.client.agentActionEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } })).map((row) => row.kind);
}

describe.skipIf(!url)("agent actions (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    savedPolicy = (await m.client.appSetting.findUnique({ where: { key: OPS_KEY } }))?.value;
    savedPause = (await m.client.appSetting.findUnique({ where: { key: PAUSE_KEY } }))?.value;
    await m.client.appSetting.deleteMany({ where: { key: PAUSE_KEY } });
    for (const [id, role] of [[admin, "ADMIN"], [opsCasesRead, "OPS_MANAGER"], [opsCasesManage, "OPS_MANAGER"], [opsApprovalsRead, "OPS_MANAGER"]] as const) {
      await m.client.user.create({ data: { id, name: id, email: `${id}@example.invalid`, role, passwordHash: "fixture-only" } });
    }
    const assignments = {
      [opsCasesRead]: { presetId: "existing", overrides: { cases: "read", approvals: "manage" } },
      [opsCasesManage]: { presetId: "existing", overrides: { cases: "manage", approvals: "manage" } },
      [opsApprovalsRead]: { presetId: "existing", overrides: { cases: "manage", approvals: "read" } },
    };
    const policy = { revision: 1, presets: [], assignments };
    await m.client.appSetting.upsert({ where: { key: OPS_KEY }, create: { key: OPS_KEY, value: policy }, update: { value: policy } });
    const agent = await createAgent({ name: `Hermes ${tag}`, areas: ["cases"], writeAreas: ["cases_write", "jobs_reschedule"], expiresInDays: 30 }, admin);
    context = await authenticateAgent(`Bearer ${agent.token}`);
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    m.notice.mockResolvedValue([{ state: "inbox_available" }]);
    m.caseUpdated.mockResolvedValue(undefined);
    m.caseCreated.mockResolvedValue(undefined);
    m.verify.mockResolvedValue(undefined);
    caseId = await fresh();
  });

  afterAll(async () => {
    if (!m.client) return;
    // The request history refuses DELETE by design; lift the guard only to remove these fixtures.
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionEvent" DISABLE TRIGGER "AgentActionEvent_append_only"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionRequest" DISABLE TRIGGER "AgentActionRequest_guard"`);
    const agents = await m.client.agentProfile.findMany({ where: { createdById: admin }, select: { id: true } });
    const requestIds = (await m.client.agentActionRequest.findMany({ where: { agentId: { in: agents.map((a) => a.id) } }, select: { id: true } })).map((r) => r.id);
    await m.client.agentActionEvent.deleteMany({ where: { requestId: { in: requestIds } } });
    await m.client.agentActionRequest.deleteMany({ where: { id: { in: requestIds } } });
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionEvent" ENABLE TRIGGER "AgentActionEvent_append_only"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionRequest" ENABLE TRIGGER "AgentActionRequest_guard"`);
    await m.client.agentProfile.deleteMany({ where: { createdById: admin } });
    await m.client.caseComment.deleteMany({ where: { issueTicket: { title: { contains: tag } } } });
    await m.client.issueTicket.deleteMany({ where: { title: { contains: tag } } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: [admin, opsCasesRead, opsCasesManage, opsApprovalsRead] } } });
    await m.client.user.deleteMany({ where: { id: { in: [admin, opsCasesRead, opsCasesManage, opsApprovalsRead] } } });
    await m.client.appSetting.deleteMany({ where: { key: { in: [OPS_KEY, PAUSE_KEY] } } });
    if (savedPolicy !== undefined) await m.client.appSetting.create({ data: { key: OPS_KEY, value: savedPolicy as never } });
    if (savedPause !== undefined) await m.client.appSetting.create({ data: { key: PAUSE_KEY, value: savedPause as never } });
    await m.client.$disconnect();
  });

  it("returns the same request for a repeated key, refuses a reused key with other arguments, and notifies once", async () => {
    const idempotencyKey = key();
    const first = await proposeAgentAction(context, "request_case_note", { caseId, note: "Guest called about the lockbox", idempotencyKey });
    const again = await proposeAgentAction(context, "request_case_note", { caseId, note: "Guest called about the lockbox", idempotencyKey });
    expect(again).toMatchObject({ requestId: first.requestId, repeated: true, status: "WAITING" });
    expect(first.summary).toContain(`Fixture case ${tag}`);
    expect(await m.client.agentActionRequest.count({ where: { agentId: context.agentId, idempotencyKey } })).toBe(1);
    await expect(proposeAgentAction(context, "request_case_note", { caseId, note: "Something else", idempotencyKey })).rejects.toMatchObject({ code: "KEY_REUSED" });
    expect(m.notice).toHaveBeenCalledTimes(1);
    expect(await events(first.requestId)).toEqual(["CREATED"]);

    const raced = key();
    const both = await Promise.all([1, 2].map(() => proposeAgentAction(context, "request_case_note", { caseId, note: "Same time", idempotencyKey: raced })));
    expect(both[0].requestId).toBe(both[1].requestId);
  });

  it("refuses a request whose dry run fails, and stores nothing", async () => {
    await expect(proposeAgentAction(context, "request_case_note", { caseId: "no-such-case", note: "x", idempotencyKey: key() })).rejects.toMatchObject({ code: "PRECONDITION" });
    await expect(proposeAgentAction(context, "request_acknowledge_stock_need", { needId: randomUUID(), reason: "x", idempotencyKey: key() })).rejects.toMatchObject({ code: "SCOPE" });
  });

  it("expires requests nobody decided: the hourly sweep, and an approval that arrives too late", async () => {
    const old = new Date(Date.now() - 25 * 3_600_000);
    const swept = await proposeAgentAction(context, "request_case_note", { caseId, note: "Old", idempotencyKey: key() }, old);
    const late = await proposeAgentAction(context, "request_case_note", { caseId, note: "Old too", idempotencyKey: key() }, old);
    const result = await expireAgentRequests();
    expect(result.expired).toBeGreaterThanOrEqual(2);
    expect(await status(swept.requestId)).toBe("EXPIRED");
    expect(await events(swept.requestId)).toEqual(["CREATED", "EXPIRED"]);
    await expect(decideAgentRequest({ requestId: late.requestId, approver: as(admin), decision: "approve" })).rejects.toMatchObject({ code: "DECIDED" });

    const lapsed = await proposeAgentAction(context, "request_case_note", { caseId, note: "Lapsed", idempotencyKey: key() }, old);
    // Not swept yet: approval finds it past its time, marks it EXPIRED and applies nothing.
    await expect(decideAgentRequest({ requestId: lapsed.requestId, approver: as(admin), decision: "approve" })).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await status(lapsed.requestId)).toBe("EXPIRED");
    expect(await m.client.caseComment.count({ where: { caseId } })).toBe(0);
  });

  it("refuses a stale preview: the case changed after the agent asked, so nothing is applied and the request FAILS with the reason", async () => {
    const request = await proposeAgentAction(context, "request_case_note", { caseId, note: "Stale note", idempotencyKey: key() });
    await m.client.issueTicket.update({ where: { id: caseId }, data: { severity: "HIGH" } });
    const outcome = await decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "approve" });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.message).toMatch(/changed after the agent asked/);
    expect(await m.client.caseComment.count({ where: { caseId } })).toBe(0);
    expect(await events(request.requestId)).toEqual(["CREATED", "APPROVED", "FAILED"]);
    const audit = await m.client.auditLog.findMany({ where: { entityId: request.requestId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => [row.userId, row.action])).toEqual([[admin, "AGENT_REQUEST_APPROVED"], [admin, "AGENT_REQUEST_FAILED"]]);
  });

  it("executes through the existing case service as the approving person, who must manage cases themselves", async () => {
    const request = await proposeAgentAction(context, "request_case_note", { caseId, note: "Cleaner reports a cracked tile", idempotencyKey: key() });
    // Cases at read: cannot add notes themselves, so cannot approve.
    await expect(decideAgentRequest({ requestId: request.requestId, approver: as(opsCasesRead), decision: "approve" })).rejects.toMatchObject({ status: 403 });
    // Approvals only at read: cannot decide agent requests at all.
    await expect(decideAgentRequest({ requestId: request.requestId, approver: as(opsApprovalsRead), decision: "reject" })).rejects.toMatchObject({ status: 403 });
    expect(await status(request.requestId)).toBe("WAITING");

    const outcome = await decideAgentRequest({ requestId: request.requestId, approver: as(opsCasesManage), decision: "approve" });
    expect(outcome).toEqual({ status: "EXECUTED", message: "Internal note added." });
    const comments = await m.client.caseComment.findMany({ where: { caseId } });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ authorUserId: opsCasesManage, isInternal: true });
    expect(comments[0].body).toContain("Cleaner reports a cracked tile");
    expect(m.caseUpdated).toHaveBeenCalledWith(expect.objectContaining({ notifyClient: false }));
    expect(await events(request.requestId)).toEqual(["CREATED", "APPROVED", "EXECUTED"]);
    const row = await m.client.agentActionRequest.findUniqueOrThrow({ where: { id: request.requestId } });
    expect(row).toMatchObject({ decidedById: opsCasesManage, status: "EXECUTED" });
    await expect(decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "approve" })).rejects.toMatchObject({ code: "DECIDED" });
  });

  it("opens a case only as an office case the client cannot see", async () => {
    const request = await proposeAgentAction(context, "request_create_case", { title: `Agent case ${tag}`, caseType: "OPS", description: "Bins not collected", idempotencyKey: key() });
    const outcome = await decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "approve" });
    expect(outcome.status).toBe("EXECUTED");
    const created = await m.client.issueTicket.findFirstOrThrow({ where: { title: `Agent case ${tag}` } });
    expect(created).toMatchObject({ source: "AGENT", clientVisible: false, caseType: "OPS" });
    expect(m.caseCreated).toHaveBeenCalledTimes(1);
  });

  it("is refused while testing as someone, and leaves the request waiting", async () => {
    const request = await proposeAgentAction(context, "request_case_note", { caseId, note: "Impersonation", idempotencyKey: key() });
    await expect(decideAgentRequest({ requestId: request.requestId, approver: as(admin, true), decision: "approve" })).rejects.toMatchObject({ code: "IMPERSONATING", status: 403 });
    await expect(decideAgentRequest({ requestId: request.requestId, approver: as(admin, true), decision: "reject" })).rejects.toMatchObject({ code: "IMPERSONATING" });
    expect(await status(request.requestId)).toBe("WAITING");
  });

  it("asks for the approver's own PIN only where the same action by a person needs one", async () => {
    expect(AGENT_ACTION_TOOLS.map(decisionNeedsPin)).toEqual([false, false, false, false]);
    const request = await proposeAgentAction(context, "request_case_note", { caseId, note: "PIN path", idempotencyKey: key() });
    const executors = { ...ACTION_EXECUTORS, request_case_note: { ...ACTION_EXECUTORS.request_case_note, sensitiveAction: "cases.delete" as const } };
    m.verify.mockRejectedValueOnce(Object.assign(new Error("Enter your PIN."), { code: "PIN_REQUIRED" }));
    await expect(decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "approve" }, { executors })).rejects.toThrow("Enter your PIN.");
    expect(await status(request.requestId)).toBe("WAITING");
    const outcome = await decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "approve", credentials: { pin: "2468" } }, { executors });
    expect(outcome.status).toBe("EXECUTED");
    expect(m.verify).toHaveBeenLastCalledWith(admin, { pin: "2468" }, "cases.delete");
  });

  it("Pause all agents stops new requests and stops waiting requests being executed (reject still works)", async () => {
    const waiting = await proposeAgentAction(context, "request_case_note", { caseId, note: "Before pause", idempotencyKey: key() });
    await setAgentsPaused(true, admin);
    try {
      const before = await m.client.agentActionRequest.count({ where: { agentId: context.agentId } });
      await expect(proposeAgentAction(context, "request_case_note", { caseId, note: "During pause", idempotencyKey: key() })).rejects.toMatchObject({ code: "PAUSED" });
      expect(await m.client.agentActionRequest.count({ where: { agentId: context.agentId } })).toBe(before);
      await expect(decideAgentRequest({ requestId: waiting.requestId, approver: as(admin), decision: "approve" })).rejects.toMatchObject({ code: "AGENTS_PAUSED" });
      expect(await status(waiting.requestId)).toBe("WAITING");
      expect(await m.client.caseComment.count({ where: { caseId } })).toBe(0);
      expect(await decideAgentRequest({ requestId: waiting.requestId, approver: as(admin), decision: "reject", reason: "Paused for review" })).toMatchObject({ status: "REJECTED" });
      expect(await m.client.agentActionRequest.findUniqueOrThrow({ where: { id: waiting.requestId } })).toMatchObject({ status: "REJECTED", decisionReason: "Paused for review", decidedById: admin });
    } finally {
      await setAgentsPaused(false, admin);
    }
  });

  it("fails a waiting request when the agent's write pack was withdrawn before approval", async () => {
    const request = await proposeAgentAction(context, "request_case_note", { caseId, note: "Withdrawn", idempotencyKey: key() });
    await setAgentWriteAreas(context.agentId, { writeAreas: ["jobs_reschedule"] }, admin);
    try {
      const outcome = await decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "approve" });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.message).toMatch(/no longer has this write access/);
      expect(await m.client.caseComment.count({ where: { caseId } })).toBe(0);
    } finally {
      await setAgentWriteAreas(context.agentId, { writeAreas: ["cases_write", "jobs_reschedule"] }, admin);
    }
  });

  it("reschedules through the existing service with the preview's version, and refuses when the job changed", async () => {
    const plan = (updatedAt: string) => ({ kind: "ok", result: { jobId: "job-x", propertyName: "Beach House", fromDate: "2026-11-20", toDate: "2026-11-21", toCleanerName: null, blockers: [], warnings: [{ kind: "notice", text: "The reschedule notifies the assigned cleaners." }], plan: { reschedule: { date: "2026-11-21", expectedUpdatedAt: updatedAt }, assign: null } } });
    m.check.mockResolvedValue(plan("2026-11-13T00:00:00.000Z"));
    const fine = await proposeAgentAction(context, "request_reschedule_job", { jobId: "job-x", toDate: "2026-11-21", reason: "Guest checks out late", idempotencyKey: key() });
    expect(fine.effects).toEqual(["The reschedule notifies the assigned cleaners."]);
    expect(m.reschedule).not.toHaveBeenCalled();
    const done = await decideAgentRequest({ requestId: fine.requestId, approver: as(admin), decision: "approve" });
    expect(done.status).toBe("EXECUTED");
    expect(m.reschedule).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-x", date: "2026-11-21", userId: admin, expectedUpdatedAt: "2026-11-13T00:00:00.000Z" }));

    m.reschedule.mockClear();
    const stale = await proposeAgentAction(context, "request_reschedule_job", { jobId: "job-x", toDate: "2026-11-21", reason: "Again", idempotencyKey: key() });
    m.check.mockResolvedValue(plan("2026-11-13T05:00:00.000Z"));
    const refused = await decideAgentRequest({ requestId: stale.requestId, approver: as(admin), decision: "approve" });
    expect(refused.status).toBe("FAILED");
    expect(m.reschedule).not.toHaveBeenCalled();

    // An operations manager without Calendar at manage cannot approve a reschedule.
    const third = await proposeAgentAction(context, "request_reschedule_job", { jobId: "job-x", toDate: "2026-11-21", reason: "Third", idempotencyKey: key() });
    const policy = { revision: 2, presets: [], assignments: { [opsCasesManage]: { presetId: "existing", overrides: { cases: "manage", approvals: "manage", calendar: "read" } } } };
    const saved = (await m.client.appSetting.findUniqueOrThrow({ where: { key: OPS_KEY } })).value;
    await m.client.appSetting.update({ where: { key: OPS_KEY }, data: { value: policy } });
    try {
      await expect(decideAgentRequest({ requestId: third.requestId, approver: as(opsCasesManage), decision: "approve" })).rejects.toBeInstanceOf(AgentDecisionError);
      expect(await status(third.requestId)).toBe("WAITING");
    } finally {
      await m.client.appSetting.update({ where: { key: OPS_KEY }, data: { value: saved as never } });
    }
  });

  it("keeps the history: events are append-only and what was asked cannot change", async () => {
    const request = await proposeAgentAction(context, "request_case_note", { caseId, note: "Guarded", idempotencyKey: key() });
    const event = await m.client.agentActionEvent.findFirstOrThrow({ where: { requestId: request.requestId } });
    await expect(m.client.agentActionEvent.update({ where: { id: event.id }, data: { kind: "EXECUTED" } })).rejects.toThrow(/append-only/);
    await expect(m.client.agentActionEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    await expect(m.client.agentActionRequest.update({ where: { id: request.requestId }, data: { arguments: { caseId, note: "Changed" } } })).rejects.toThrow(/cannot be changed/);
    await expect(m.client.agentActionRequest.update({ where: { id: request.requestId }, data: { status: "EXECUTED" } })).rejects.toThrow(/cannot move/);
    await expect(m.client.agentActionRequest.delete({ where: { id: request.requestId } })).rejects.toThrow(/cannot be deleted/);
    await decideAgentRequest({ requestId: request.requestId, approver: as(admin), decision: "reject" });
    await expect(m.client.agentActionRequest.update({ where: { id: request.requestId }, data: { status: "WAITING" } })).rejects.toThrow(/decided/);
  });
});
