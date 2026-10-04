// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: vi.fn(), reviews: vi.fn(), update: vi.fn(), rotation: vi.fn(), lock: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx } }));
vi.mock("@/lib/accountability/rotation", () => ({ applyJobRotationCompletion: m.rotation }));
import { recomputeJobQaOutcome } from "@/lib/qa/authority";
let tx: any;
beforeEach(() => { vi.resetAllMocks(); tx = { $queryRaw: m.lock, job: { findUnique: m.job, update: m.update }, qAReview: { findMany: m.reviews } }; m.tx.mockImplementation((fn: any) => fn(tx)); m.job.mockResolvedValue({ id: "j", propertyId: "p", status: "QA_REVIEW", completedAt: new Date("2026-09-01T12:34Z") }); m.reviews.mockResolvedValue([{ id: "r", kind: "QA", score: 90, passed: true, createdAt: new Date() }]); });
it("authoritative pass counts rotation with same transaction and preserves timestamp", async () => {
 expect(await recomputeJobQaOutcome("j")).toMatchObject({ status: "COMPLETED" });
 expect(m.update.mock.calls[0][0].data.completedAt).toEqual(new Date("2026-09-01T12:34Z"));
 expect(m.rotation).toHaveBeenCalledWith(tx, { jobId: "j", propertyId: "p" });
});
it("failed authoritative review does not count rotation", async () => { m.reviews.mockResolvedValue([{ id: "r", kind: "QA", score: 20, passed: false, createdAt: new Date() }]); await recomputeJobQaOutcome("j"); expect(m.rotation).not.toHaveBeenCalled(); });
it("rotation persistence failure rejects completion transaction", async () => { m.rotation.mockRejectedValue(new Error("counter unavailable")); await expect(recomputeJobQaOutcome("j")).rejects.toThrow("counter unavailable"); });
