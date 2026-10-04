// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
 auth: vi.fn(), job: vi.fn(), jobs: vi.fn(), jobUpdate: vi.fn(), user: vi.fn(), users: vi.fn(), client: vi.fn(), assignment: vi.fn(), assignments: vi.fn(), upsert: vi.fn(), log: vi.fn(), logs: vi.fn(), logUpdate: vi.fn(), adjustment: vi.fn(), notice: vi.fn(), notices: vi.fn(), audit: vi.fn(), transaction: vi.fn(), report: vi.fn(),
 settings: vi.fn(), apply: vi.fn(), approval: vi.fn(), continuationGet: vi.fn(), continuationDecide: vi.fn(), continuationCreate: vi.fn(), earlyList: vi.fn(), earlyDecide: vi.fn(), email: vi.fn(), sms: vi.fn(), push: vi.fn(), lifecycle: vi.fn(), history: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: {
 job: { findUnique: m.job, findMany: m.jobs, update: m.jobUpdate }, user: { findFirst: m.user, findMany: m.users }, client: { findUnique: m.client },
 jobAssignment: { findFirst: m.assignment, findMany: m.assignments, upsert: m.upsert }, timeLog: { findUnique: m.log, findMany: m.logs, findFirst: vi.fn(), update: m.logUpdate }, cleanerPayAdjustment: { create: m.adjustment },
 notification: { create: m.notice, createMany: m.notices }, auditLog: { create: m.audit }, $transaction: m.transaction, report: { findUnique: m.report },
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/ops/dispatch", () => ({ applyAutoAssignment: m.apply }));
vi.mock("@/lib/commercial/client-approvals", () => ({ createClientApproval: m.approval, listClientApprovals: vi.fn() }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ getContinuationRequestById: m.continuationGet, decideContinuationRequest: m.continuationDecide, createContinuationRequest: m.continuationCreate, listContinuationRequests: vi.fn() }));
vi.mock("@/lib/jobs/early-checkout-requests", () => ({ listEarlyCheckoutRequests: m.earlyList, decideEarlyCheckoutRequest: m.earlyDecide }));
vi.mock("@/lib/notification-templates", () => ({ renderNotificationTemplate: () => ({ webBody: "Job offered", smsBody: "Job offered" }) }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Assignment", html: "Assignment" }), buildBulkAssignedEmail: () => ({ subject: "Assignments", html: "Assignments" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: m.history }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://example.invalid${path}` }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { db } from "@/lib/db";
import { POST as approval } from "@/app/api/admin/client-approvals/route";
import { POST as dispatch } from "@/app/api/admin/dispatch/auto-assign/[jobId]/apply/route";
import { PATCH as continuation } from "@/app/api/admin/job-continuations/[id]/route";
import { POST as remind } from "@/app/api/admin/jobs/[id]/remind/route";
import { PATCH as skip } from "@/app/api/admin/jobs/[id]/skip/route";
import { PATCH as timeLog } from "@/app/api/admin/jobs/[id]/time-logs/[timeLogId]/route";
import { POST as bulk } from "@/app/api/admin/jobs/bulk-assign/route";
import { PATCH as early } from "@/app/api/cleaner/job-early-checkouts/[id]/route";
import { POST as pay } from "@/app/api/cleaner/jobs/[id]/approval-request/route";
import { POST as reschedule } from "@/app/api/cleaner/jobs/[id]/reschedule-request/route";
const req = (data: unknown) => new NextRequest("http://localhost", { method: "POST", body: JSON.stringify(data) });
const params = { params: { id: "job" } };
const cleaner = { id: "cleaner", name: "Cleaner", email: null, phone: null };
function job() { return { id: "job", jobNumber: "JOB-1", jobType: "GENERAL_CLEAN", status: "IN_PROGRESS", cleanSkipStatus: "REQUESTED", scheduledDate: new Date("2026-10-03T00:00:00Z"), property: { name: "Home", clientId: "client", client: { users: [{ id: "client-user" }] } }, assignments: [{ userId: "actor", removedAt: null, user: { id: "actor", name: "Actor" } }] }; }
beforeEach(() => {
 vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "actor", name: "Actor" } }); m.settings.mockResolvedValue({});
 m.job.mockResolvedValue(job()); m.jobs.mockResolvedValue([job()]); m.jobUpdate.mockResolvedValue({ id: "job", cleanSkipStatus: "SKIPPED" });
 m.user.mockResolvedValue(cleaner); m.users.mockResolvedValue([{ id: "office", email: null }]); m.client.mockResolvedValue({ id: "client", name: "Client" });
 m.assignment.mockResolvedValue({ id: "assignment", removedAt: null }); m.assignments.mockResolvedValue([]); m.logs.mockResolvedValue([]);
 m.log.mockResolvedValue({ id: "log", jobId: "job", userId: "cleaner", startedAt: new Date("2026-10-03T10:00:00Z"), stoppedAt: new Date("2026-10-03T11:00:00Z"), durationM: 60, job: { jobNumber: "JOB-1" } });
 m.transaction.mockImplementation(async fn => fn(db)); m.logUpdate.mockResolvedValue({ id: "log" }); m.report.mockResolvedValue(null);
 m.approval.mockResolvedValue({ id: "approval", title: "Extra work" }); m.adjustment.mockResolvedValue({ id: "pay" });
 m.continuationGet.mockResolvedValue({ id: "job" }); m.continuationDecide.mockResolvedValue({ id: "job", jobId: "job", requestedByUserId: "cleaner", status: "APPROVED" }); m.continuationCreate.mockResolvedValue({ id: "request" });
 m.earlyList.mockResolvedValue([{ id: "job", jobId: "job" }]); m.earlyDecide.mockResolvedValue({ id: "job" });
 m.lifecycle.mockResolvedValue({}); m.history.mockResolvedValue({}); m.email.mockResolvedValue({ ok: true }); m.sms.mockResolvedValue({ status: "sent", ok: true });
});
const cases = [
 { name: "client approval", run: () => { m.users.mockResolvedValue([{ id: "client-user", email: null }]); return approval(req({ clientId: "client", title: "Extra work", amount: 20 })); }, status: 201, category: "approvals", recipient: "client-user", many: true, mutation: m.approval },
 { name: "auto assignment", run: () => { m.users.mockResolvedValue([cleaner]); return dispatch(req({ cleanerIds: ["cleaner"] }), { params: { jobId: "job" } }); }, status: 200, category: "jobs", recipient: "cleaner", many: false, mutation: m.apply },
 { name: "continuation decision", run: () => continuation(req({ decision: "APPROVE" }), params), status: 200, category: "jobs", recipient: "cleaner", many: false, mutation: m.continuationDecide },
 { name: "reminder", run: () => remind(req({ method: "PUSH" }), params), status: 200, category: "jobs", recipient: "actor", many: false, mutation: m.audit },
 { name: "skip decision", run: () => skip(req({ action: "approve" }), params), status: 200, category: "jobs", recipient: "client-user", many: true, mutation: m.jobUpdate },
 { name: "time log", run: () => timeLog(req({ notes: "Corrected" }), { params: { id: "job", timeLogId: "log" } }), status: 200, category: "jobs", recipient: "cleaner", many: false, mutation: m.logUpdate },
 { name: "bulk assignment", run: () => bulk(req({ jobIds: ["job"], cleanerUserId: "cleaner" })), status: 200, category: "jobs", recipient: "cleaner", many: false, mutation: m.upsert },
 { name: "early checkout", run: () => early(req({ decision: "APPROVE" }), params), status: 200, category: "approvals", recipient: "office", many: true, mutation: m.earlyDecide },
 { name: "pay request", run: () => pay(req({ title: "Extra work", amount: 20 }), params), status: 201, category: "approvals", recipient: "office", many: true, mutation: m.adjustment },
 { name: "reschedule request", run: () => reschedule(req({ reason: "More time needed" }), params), status: 201, category: "approvals", recipient: "office", many: true, mutation: m.continuationCreate },
];
it.each(cases)("$name denies unauthorized entry before data/mutations", async c => {
 m.auth.mockRejectedValue(new Error("FORBIDDEN"));
 expect((await c.run()).status).toBe(403);
 expect(c.mutation).not.toHaveBeenCalled(); expect(m.job).not.toHaveBeenCalled(); expect(m.notice).not.toHaveBeenCalled(); expect(m.notices).not.toHaveBeenCalled();
});
it.each(cases)("$name emits the intended category to the resolved recipient", async c => {
 const response = await c.run(); expect(response.status).toBe(c.status);
 const notice = c.many ? m.notices.mock.calls[0][0].data[0] : m.notice.mock.calls[0][0].data;
 expect(notice).toMatchObject({ userId: c.recipient, externalId: expect.stringContaining(c.category), channel: "PUSH", status: "SENT", sentAt: expect.any(Date) });
 expect(c.mutation).toHaveBeenCalled();
});
it.each(cases)("$name reports or deliberately absorbs notification storage failure", async c => {
 (c.many ? m.notices : m.notice).mockRejectedValue(new Error("inbox unavailable"));
 const response = await c.run();
 if (c.name === "reminder") { expect(response.status).toBe(200); expect(await response.json()).toEqual({ sent: [], failed: ["Actor"] }); }
 else if (c.name === "skip decision") expect(response.status).toBe(200);
 else { expect(response.status).toBe(400); expect((await response.json()).error).toBe("inbox unavailable"); }
 expect(c.mutation).toHaveBeenCalled();
});
it("client approval recipient lookup is scoped to active users of that client", async () => {
 await cases[0].run();
 expect(m.users).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "CLIENT", clientId: "client", isActive: true } }));
 expect(m.approval).toHaveBeenCalledWith(expect.objectContaining({ requestedByUserId: "actor", metadata: expect.objectContaining({ recipientUserIds: ["client-user"] }) }));
});
it("auto dispatch only looks up active selected cleaners for notices", async () => {
 await cases[1].run(); expect(m.apply).toHaveBeenCalledWith("job", ["cleaner"], "actor");
 expect(m.users.mock.calls[0][0].where).toMatchObject({ id: { in: ["cleaner"] }, isActive: true });
});
it.each([7, 9])("cleaner request route %s denies foreign assignment before mutations", async index => {
 m.assignment.mockResolvedValue(null); expect((await cases[index].run()).status).toBe(403);
 expect(cases[index].mutation).not.toHaveBeenCalled(); expect(m.notices).not.toHaveBeenCalled();
});
it("pay request denies removed assignment before creating a payable row", async () => {
 m.job.mockResolvedValue({ ...job(), assignments: [{ userId: "actor", removedAt: new Date() }] });
 expect((await cases[8].run()).status).toBe(403); expect(m.adjustment).not.toHaveBeenCalled(); expect(m.notices).not.toHaveBeenCalled();
});
it("time-log update is bound to the route job before transaction or notice", async () => {
 m.log.mockResolvedValue({ id: "log", jobId: "other" });
 expect((await cases[5].run()).status).toBe(404); expect(m.transaction).not.toHaveBeenCalled(); expect(m.notice).not.toHaveBeenCalled();
});
