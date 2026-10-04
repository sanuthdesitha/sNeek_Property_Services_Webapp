// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), existing: vi.fn(), job: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
import { ensureQaAssignmentForCompletedJob, tryEnsureQaAssignmentForCompletedJob } from "@/lib/qa/auto-assignment";
const tx = { $queryRaw: m.lock, qaAssignment: { findFirst: m.existing, create: m.create }, job: { findUnique: m.job } };
beforeEach(() => { vi.resetAllMocks(); m.transaction.mockImplementation(async fn => fn(tx)); m.job.mockResolvedValue({ id: "job" }); });
afterEach(() => vi.restoreAllMocks());
it("empty job input is a noop without starting a transaction", async () => {
 await ensureQaAssignmentForCompletedJob(""); expect(m.transaction).not.toHaveBeenCalled();
});
it("locks the job before checking and creating the assignment within one transaction", async () => {
 await ensureQaAssignmentForCompletedJob("job");
 expect(m.lock.mock.calls[0][0].join("?")).toContain('FOR UPDATE'); expect(m.lock.mock.calls[0][1]).toBe("job");
 expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.existing.mock.invocationCallOrder[0]);
 expect(m.existing.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
 expect(m.create).toHaveBeenCalledWith({ data: { jobId: "job", status: "OPEN" } });
 expect(m.transaction).toHaveBeenCalledOnce();
});
it("existing assignment is a locked noop without creating a duplicate", async () => {
 m.existing.mockResolvedValue({ id: "assignment" });
 await ensureQaAssignmentForCompletedJob("job");
 expect(m.lock).toHaveBeenCalledOnce(); expect(m.job).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("missing job is a noop after locking and rechecking", async () => {
 m.job.mockResolvedValue(null); await ensureQaAssignmentForCompletedJob("deleted"); expect(m.create).not.toHaveBeenCalled();
});
it("core creation failure rejects rather than claiming a successful assignment", async () => {
 m.create.mockRejectedValue(new Error("write failed"));
 await expect(ensureQaAssignmentForCompletedJob("job")).rejects.toThrow("write failed");
});
it("best-effort wrapper logs and absorbs a transaction failure", async () => {
 const log = vi.spyOn(console, "error").mockImplementation(() => {});
 m.transaction.mockRejectedValue(new Error("transaction unavailable"));
 await expect(tryEnsureQaAssignmentForCompletedJob("job")).resolves.toBeUndefined();
 expect(log).toHaveBeenCalledWith("[qa] failed to ensure QaAssignment for job", "job", expect.any(Error));
 expect(m.create).not.toHaveBeenCalled();
});
