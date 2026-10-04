// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), settings: vi.fn(), job: vi.fn(), self: vi.fn(), transaction: vi.fn(), lock: vi.fn(), advisory: vi.fn(), review: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), rotation: vi.fn(), recompute: vi.fn(), loyalty: vi.fn(), followups: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, $transaction: m.transaction } }));
vi.mock("@/lib/qa/self-review", () => ({ assertNotSelfInspection: m.self }));
vi.mock("@/lib/accountability/rotation", () => ({ applyJobRotationCompletion: m.rotation }));
vi.mock("@/lib/qa/authority", () => ({ recomputeJobQaOutcome: m.recompute }));
vi.mock("@/lib/client/rewards", () => ({ awardLoyaltyForCompletedJob: m.loyalty }));
vi.mock("@/lib/ops/follow-up-sequences", () => ({ scheduleJobFollowUps: m.followups }));
vi.mock("@/lib/notifications/accountability", () => ({ notifyQaResultToCleaner: m.notify }));
vi.mock("@/lib/cases/auto-case", () => ({ autoResolveJobCases: vi.fn(), findOpenAutoCase: vi.fn(), meetsAutoOpenThreshold: vi.fn() }));
vi.mock("@/lib/qa/admin-rework", () => ({ getAdminReworkContext: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { POST } from "@/app/api/admin/jobs/[id]/qa/route";
const tx = { $executeRaw: m.advisory, $queryRaw: m.lock, qAReview: { findFirst: m.review, create: m.create }, job: { update: m.update }, auditLog: { create: m.audit } };
const run = (score = 90) => POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ score }) }), { params: { id: "job" } });
beforeEach(() => {
 vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
 m.settings.mockResolvedValue({ qaAutomation: { failureThreshold: 80 }, caseAutomation: {} });
 m.job.mockResolvedValue({ id: "job", status: "SUBMITTED", propertyId: "property", completedAt: null });
 m.lock.mockResolvedValue([{ status: "SUBMITTED", completedAt: null }]); m.transaction.mockImplementation(async fn => fn(tx));
 m.create.mockResolvedValue({ id: "review" }); m.recompute.mockResolvedValue(null); m.loyalty.mockResolvedValue(null); m.followups.mockResolvedValue(null); m.notify.mockResolvedValue(null);
});
it("self-inspection guard denies the live actor before review transaction", async () => {
 m.self.mockRejectedValue(new Error("FORBIDDEN"));
 expect((await run()).status).toBe(403);
 expect(m.self).toHaveBeenCalledWith(expect.anything(), { jobId: "job", candidateUserId: "admin", isSelf: true });
 expect(m.transaction).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it.each([{ fresh: [] }, { fresh: [{ status: "INVOICED", completedAt: new Date() }] }])("fresh locked job rejects stale preflight eligibility: %j", async ({ fresh }) => {
 m.lock.mockResolvedValue(fresh);
 const response = await run(); expect(response.status).toBe(400);
 expect((await response.json()).error).toContain("no longer available for QA");
 expect(m.review).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.rotation).not.toHaveBeenCalled();
});
it("duplicate save skips review/status/rotation and downstream rewards", async () => {
 m.review.mockResolvedValueOnce({ id: "existing" });
 expect(await (await run()).json()).toMatchObject({ id: "existing", duplicate: true });
 expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.rotation).not.toHaveBeenCalled(); expect(m.loyalty).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it("authoritative failed inspector review overrides passing admin score without rotation completion", async () => {
 m.review.mockResolvedValueOnce(null).mockResolvedValueOnce({ passed: false });
 expect((await run()).status).toBe(200);
 expect(m.update).toHaveBeenCalledWith({ where: { id: "job" }, data: { status: "QA_REVIEW", completedAt: null } });
 expect(m.rotation).not.toHaveBeenCalled();
});
it("authoritative passing inspector review preserves locked completion date despite failing admin score", async () => {
 const completedAt = new Date("2026-09-01T10:00:00Z"); m.lock.mockResolvedValue([{ status: "COMPLETED", completedAt }]);
 m.review.mockResolvedValueOnce(null).mockResolvedValueOnce({ passed: true });
 expect((await run(20)).status).toBe(200);
 expect(m.update).toHaveBeenCalledWith({ where: { id: "job" }, data: { status: "COMPLETED", completedAt } });
 expect(m.rotation).toHaveBeenCalledWith(tx, { jobId: "job", propertyId: "property" });
});
it("passing quick score without inspector stamps completion and applies rotation in the core transaction", async () => {
 expect((await run()).status).toBe(200);
 expect(m.update).toHaveBeenCalledWith({ where: { id: "job" }, data: { status: "COMPLETED", completedAt: expect.any(Date) } });
 expect(m.rotation).toHaveBeenCalledWith(tx, { jobId: "job", propertyId: "property" });
 expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
});
it("core rotation failure rejects instead of launching postcommit effects", async () => {
 m.rotation.mockRejectedValue(new Error("rotation failed"));
 expect((await run()).status).toBe(400); expect(m.recompute).not.toHaveBeenCalled(); expect(m.loyalty).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
