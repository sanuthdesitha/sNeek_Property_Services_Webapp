// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: {} as any, admins: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => key }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.notify }));
vi.mock("@/lib/phase4/analytics", () => ({ applyReschedule: vi.fn() }));
import { applyCleanerJobTaskUpdates } from "@/lib/job-tasks/service";
let tx: any;
const input = { jobId: "j", propertyId: "p", cleanerId: "c", taskUpdates: [{ id: "t", decision: "NOT_APPLICABLE" as const, note: "Soil already moist", proofKeys: ["plant.jpg"] }] };
beforeEach(() => { tx = { job: { findUnique: vi.fn().mockResolvedValue({ id: "j" }), findFirst: vi.fn() }, jobTask: { findUnique: vi.fn().mockResolvedValue({ id: "t", jobId: "j", executionStatus: "OPEN", metadata: { allowNotApplicable: true } }), update: vi.fn(), create: vi.fn() }, jobTaskAttachment: { createMany: vi.fn() } }; });
it("records neutral disposition, reason and proof; creates no carryforward or completed timestamp", async () => {
 await applyCleanerJobTaskUpdates(input, { transaction: tx, afterCommit: [] });
 expect(tx.jobTask.update.mock.calls[0][0].data).toMatchObject({ executionStatus: "CANCELLED", completedAt: null, metadata: { disposition: "NOT_APPLICABLE", notApplicable: { reason: "Soil already moist", proofKeys: ["plant.jpg"] } }, events: { create: { action: "TASK_NOT_APPLICABLE" } } });
 expect(tx.jobTask.create).not.toHaveBeenCalled(); expect(tx.job.findFirst).not.toHaveBeenCalled();
});
it.each([{ note: "", proofKeys: ["p"] }, { note: "reason", proofKeys: [] }])("rejects absent reason/proof %j", async patch => {
 await expect(applyCleanerJobTaskUpdates({ ...input, taskUpdates: [{ ...input.taskUpdates[0], ...patch }] }, { transaction: tx, afterCommit: [] })).rejects.toThrow("reason and photo");
 expect(tx.jobTask.update).not.toHaveBeenCalled();
});
it("mandatory tasks cannot opt themselves out", async () => {
 tx.jobTask.findUnique.mockResolvedValue({ id: "t", jobId: "j", executionStatus: "OPEN", metadata: {} });
 await expect(applyCleanerJobTaskUpdates(input, { transaction: tx, afterCommit: [] })).rejects.toThrow("office permission"); expect(tx.jobTask.update).not.toHaveBeenCalled();
});
it("requires an after-commit queue for caller-owned transaction", async () => {
 await expect(applyCleanerJobTaskUpdates(input, { transaction: tx })).rejects.toThrow("afterCommit is required"); expect(tx.job.findUnique).not.toHaveBeenCalled();
});
it("rejects missing jobs and ignores foreign, absent or closed tasks on retry", async () => {
 tx.job.findUnique.mockResolvedValueOnce(null);
 await expect(applyCleanerJobTaskUpdates(input, { transaction: tx, afterCommit: [] })).rejects.toThrow("JOB_NOT_FOUND");
 for (const existing of [null, { jobId: "other", executionStatus: "OPEN" }, { jobId: "j", executionStatus: "CANCELLED" }]) {
  tx.jobTask.findUnique.mockResolvedValueOnce(existing); await applyCleanerJobTaskUpdates(input, { transaction: tx, afterCommit: [] });
 }
 expect(tx.jobTask.update).not.toHaveBeenCalled();
});
it.each([null, [], "malformed"])("does not grant optional permission from malformed metadata %j", async metadata => {
 tx.jobTask.findUnique.mockResolvedValue({ id: "t", jobId: "j", executionStatus: "OPEN", metadata });
 await expect(applyCleanerJobTaskUpdates(input, { transaction: tx, afterCommit: [] })).rejects.toThrow("office permission");
});
it("completion stamps time and attaches proof, while blank keys are discarded", async () => {
 await applyCleanerJobTaskUpdates({ ...input, taskUpdates: [{ id: "t", decision: "COMPLETED", proofKeys: [" ", "proof.jpg"] }] }, { transaction: tx, afterCommit: [] });
 expect(tx.jobTask.update.mock.calls[0][0].data).toMatchObject({ executionStatus: "COMPLETED", completedAt: expect.any(Date), events: { create: { action: "TASK_COMPLETED", note: null } } });
 expect(tx.jobTaskAttachment.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ kind: "COMPLETION_PROOF", label: "Completion proof", s3Key: "proof.jpg" })]);
});
it.each([null, { id: "next" }])("carries incomplete work once and defers all recipient reads until commit %j", async next => {
 m.admins.mockResolvedValue([]); m.db.user = { findMany: m.admins }; m.notify.mockClear(); m.admins.mockClear();
 tx.job.findUnique.mockResolvedValue({ id: "j", jobNumber: "JOB-1", scheduledDate: new Date("2026-10-01"), property: { name: "Home", suburb: next ? "Sydney" : null } });
 tx.job.findFirst.mockResolvedValue(next);
 tx.jobTask.findUnique.mockResolvedValue({ id: "t", jobId: "j", executionStatus: "OPEN", title: "Plant", metadata: { allowNotApplicable: true } });
 const afterCommit: Array<() => Promise<unknown>> = [];
 const result = await applyCleanerJobTaskUpdates({ ...input, clientId: next ? "client" : undefined, baseUrl: "https://example.test", taskUpdates: [{ id: "t", decision: "NOT_COMPLETED", note: next ? "Access blocked" : undefined, proofKeys: next ? ["proof.jpg"] : undefined }] }, { transaction: tx, afterCommit });
 expect(result).toMatchObject({ carriedForwardCount: 1 });
 expect(tx.jobTask.create.mock.calls[0][0].data).toMatchObject({ jobId: next?.id ?? null, visibleToCleaner: Boolean(next), metadata: { allowNotApplicable: true } });
 expect(tx.jobTask.update.mock.calls[0][0].data.completedAt).toBeNull();
 expect(m.admins).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
 expect(afterCommit).toHaveLength(1); await afterCommit[0](); expect(m.notify).toHaveBeenCalledOnce();
});
it("standalone caller retains immediate notification behavior", async () => {
 m.admins.mockResolvedValue([]); m.notify.mockClear();
 tx.job.findUnique.mockResolvedValue({ id: "j", scheduledDate: new Date("2026-10-01"), property: { name: "Home" } });
 tx.jobTask.findUnique.mockResolvedValue({ id: "t", jobId: "j", title: "Detail", executionStatus: "OPEN" });
 Object.assign(m.db, tx, { user: { findMany: m.admins } });
 await applyCleanerJobTaskUpdates({ ...input, taskUpdates: [{ id: "t", decision: "NOT_COMPLETED" }] });
 expect(m.notify).toHaveBeenCalledOnce();
});
