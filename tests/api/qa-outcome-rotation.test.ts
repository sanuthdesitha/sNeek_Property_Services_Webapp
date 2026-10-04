// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ job: vi.fn(), update: vi.fn(), audit: vi.fn(), rotation: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx } }));
vi.mock("@/lib/accountability/rotation", () => ({ applyJobRotationCompletion: m.rotation }));
vi.mock("@/lib/qa/outcome-approvals", () => ({ listQaOutcomeApprovals: vi.fn() }));
vi.mock("@/lib/client/rewards", () => ({ awardLoyaltyForCompletedJob: vi.fn() }));
vi.mock("@/lib/ops/follow-up-sequences", () => ({ scheduleJobFollowUps: vi.fn() }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { POST } from "@/app/api/admin/qa/outcomes/route";
let tx: any;
beforeEach(() => { vi.resetAllMocks(); tx = { $queryRaw: vi.fn(), job: { findUnique: m.job, update: m.update }, auditLog: { create: m.audit } }; m.tx.mockImplementation((fn: any) => fn(tx)); m.job.mockResolvedValue({ id: "j", propertyId: "p", status: "QA_REVIEW", completedAt: null }); });
const post = () => POST(new NextRequest("http://localhost/api/admin/qa/outcomes", { method: "POST", body: JSON.stringify({ jobIds: ["j"] }) }));
it("approval and rotation share one transaction", async () => { expect(await (await post()).json()).toEqual({ approved: ["j"], skipped: [] }); expect(m.rotation).toHaveBeenCalledWith(tx, { jobId: "j", propertyId: "p" }); expect(m.audit).toHaveBeenCalled(); });
it("does not report approved when atomic rotation persistence fails", async () => { m.rotation.mockRejectedValue(new Error("counter unavailable")); expect(await (await post()).json()).toEqual({ approved: [], skipped: ["j"] }); });
it("already moved outcome is not counted again by approval endpoint", async () => { m.job.mockResolvedValue({ status: "COMPLETED" }); expect(await (await post()).json()).toEqual({ approved: [], skipped: ["j"] }); expect(m.rotation).not.toHaveBeenCalled(); });
