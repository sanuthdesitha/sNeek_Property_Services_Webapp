// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { applyBulkStatus, previewBulkStatus } from "@/lib/jobs/bulk-status-store";
import { Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), assignments: vi.fn(), audit: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: m.read }, $transaction: m.transaction } }));
const row = (id = "a", status = "ASSIGNED") => ({ id, jobNumber: `JOB-${id}`, scheduledDate: new Date("2026-09-09T00:00:00Z"), status, updatedAt: new Date("2026-09-10T00:00:00Z"), completedAt: null, property: { name: `Property ${id}` }, assignments: [{ id: `${id}-assignment`, userId: "cleaner", isPrimary: true, responseStatus: "ACCEPTED" }] });
beforeEach(() => {
  vi.resetAllMocks(); m.read.mockResolvedValue([row()]); m.update.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation(async callback => callback({ $queryRaw: m.lock, job: { findMany: m.read, updateMany: m.update }, jobAssignment: { updateMany: m.assignments }, auditLog: { create: m.audit } }));
});
const input = { jobIds: ["a"], status: "UNASSIGNED" };
it.each([{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }])("reports serialization rollback without automatically retrying %j", async options => {
  m.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Conflict", { ...options, clientVersion: "test" }));
  await expect(applyBulkStatus("admin", input)).rejects.toMatchObject({ status: 409 }); expect(m.transaction).toHaveBeenCalledOnce();
});
it("does not misreport unrelated database failures as a confirmed conflict", async () => {
  const error = new Prisma.PrismaClientKnownRequestError("DB unavailable", { code: "P2010", meta: { code: "08006" }, clientVersion: "test" });
  m.transaction.mockRejectedValue(error); await expect(applyBulkStatus("admin", input)).rejects.toBe(error);
});
it.each([{ jobIds: Array.from({ length: 201 }, () => "a"), status: "COMPLETED" }, { jobIds: ["a".repeat(201)], status: "COMPLETED" }])("bounds oversized selections before database work", async body => {
  await expect(previewBulkStatus(body)).rejects.toMatchObject({ status: 400 }); expect(m.read).not.toHaveBeenCalled();
});
it("previews per-row consequences without writes and applies only that reviewed state", async () => {
  const preview = await previewBulkStatus(input); expect(m.transaction).not.toHaveBeenCalled();
  expect(preview.rows[0]).toMatchObject({ label: "JOB-a · Property a · 2026-09-09", before: "ASSIGNED", after: "UNASSIGNED", blocked: false, consequences: ["Clear completion time.", "Remove 1 active cleaner assignment."] });
  expect(await applyBulkStatus("admin", { ...input, reviewToken: preview.reviewToken })).toEqual({ ok: true, updated: 1, status: "UNASSIGNED" });
  expect(m.lock).toHaveBeenCalled(); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a", status: "ASSIGNED", updatedAt: row().updatedAt }, data: { status: "UNASSIGNED", completedAt: null } }));
  expect(m.assignments).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "a", removedAt: null } }));
  expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "admin", before: { status: "ASSIGNED" }, after: { status: "UNASSIGNED" } }) });
});
it.each(["updatedAt", "assignments", "status"])("rejects changed %s after preview before writes", async field => {
  const preview = await previewBulkStatus(input);
  m.read.mockResolvedValue([{ ...row(), [field]: field === "updatedAt" ? new Date() : field === "assignments" ? [] : "COMPLETED" }]);
  await expect(applyBulkStatus("admin", { ...input, reviewToken: preview.reviewToken })).rejects.toMatchObject({ status: 409 }); expect(m.update).not.toHaveBeenCalled();
});
it("blocks invoiced jobs inside the transaction including legacy calls", async () => {
  m.read.mockResolvedValue([row("a", "INVOICED")]); expect((await previewBulkStatus(input)).rows[0].blocked).toBe(true);
  await expect(applyBulkStatus("admin", input)).rejects.toMatchObject({ status: 409 }); expect(m.update).not.toHaveBeenCalled();
});
it.each([previewBulkStatus, (value: unknown) => applyBulkStatus("admin", value)])("rejects invalid and missing selections", async run => {
  await expect(run({ jobIds: [], status: "INVALID" })).rejects.toMatchObject({ status: 400 });
  m.read.mockResolvedValue([]); await expect(run(input)).rejects.toMatchObject({ status: 404 });
});
it("preserves completion stamping and other status semantics", async () => {
  const completed = { ...input, status: "COMPLETED" }; expect((await previewBulkStatus(completed)).rows[0].consequences[0]).toContain("including already completed");
  await applyBulkStatus("admin", completed); expect(m.update.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date); expect(m.assignments).not.toHaveBeenCalled();
  expect((await previewBulkStatus({ ...input, status: "IN_PROGRESS" })).rows[0].consequences).toEqual(["Keep completion time and active cleaner assignments unchanged."]);
  await applyBulkStatus("admin", { ...input, status: "IN_PROGRESS" }); expect(m.update.mock.calls[1][0].data).toEqual({ status: "IN_PROGRESS" });
});
it("fails a compare-and-set mismatch and propagates audit failures without success", async () => {
  m.update.mockResolvedValue({ count: 0 }); await expect(applyBulkStatus("admin", input)).rejects.toMatchObject({ status: 409 }); expect(m.audit).not.toHaveBeenCalled();
  m.update.mockResolvedValue({ count: 1 }); m.audit.mockRejectedValue(new Error("audit failed")); await expect(applyBulkStatus("admin", input)).rejects.toThrow("audit failed");
});
it("deduplicates selection and hashes deterministic row order", async () => {
  m.read.mockResolvedValue([row("b"), row("a")]); const first = await previewBulkStatus({ ...input, jobIds: ["b", "a", "a"] });
  m.read.mockResolvedValue([row("a"), row("b")]); const second = await previewBulkStatus({ ...input, jobIds: ["a", "b"] }); expect(first.reviewToken).toBe(second.reviewToken);
});
