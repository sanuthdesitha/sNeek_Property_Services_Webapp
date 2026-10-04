// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn(), job: vi.fn(), settings: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { jobTask: m, job: { findUnique: m.job } } }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => key }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.notify }));
vi.mock("@/lib/phase4/analytics", () => ({ applyReschedule: vi.fn() }));
import { syncAdminJobTasks, notifyJobTasksAdded, attachPendingAdminTasksToJob } from "@/lib/job-tasks/service";
const base = { jobId: "job1", propertyId: "property1", actorUserId: "admin", tasks: [] };
beforeEach(() => { vi.resetAllMocks(); m.findMany.mockResolvedValue([{ id: "queued", executionStatus: "OPEN" }, { id: "finished", executionStatus: "COMPLETED" }]); });
it("does not cancel queued or completed tasks absent from scope metadata", async () => {
  await syncAdminJobTasks(base);
  expect(m.updateMany).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("only cancels explicitly removed open tasks", async () => {
  await syncAdminJobTasks({ ...base, cancelTaskIds: ["queued", "finished", "foreign"] });
  expect(m.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["queued"] } }, data: { executionStatus: "CANCELLED", visibleToCleaner: false } });
});
it("returns canonical stable ID and does not recreate on subsequent save", async () => {
  m.create.mockImplementation(async ({ data }) => ({ id: data.id }));
  const result = await syncAdminJobTasks({ ...base, tasks: [{ id: "draft-1", title: "Dust", requiresPhoto: true }] });
  expect(result.canonicalTasks[0].id).toBe("admin-job1-draft-1");
  m.findMany.mockResolvedValue([{ id: "admin-job1-draft-1", executionStatus: "OPEN" }]);
  await syncAdminJobTasks({ ...base, tasks: result.canonicalTasks });
  expect(m.create).toHaveBeenCalledTimes(1); expect(m.update).toHaveBeenCalledTimes(1);
});
it("uses caller transaction and keeps notifications out of the write transaction", async () => {
  const transaction = { jobTask: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "new" }) } };
  const result = await syncAdminJobTasks({ ...base, database: transaction as any, clientId: "client", tasks: [{ title: "Photo", description: " Check soil ", allowNotApplicable: true, requiresNote: true }] });
  expect(result.addedTitles).toEqual(["Photo"]); expect(m.findMany).not.toHaveBeenCalled();
  expect(transaction.jobTask.create.mock.calls[0][0].data).toMatchObject({ description: "Check soil", clientId: "client", requiresNote: true, metadata: { allowNotApplicable: true } });
});
it("preserves completed history, ignores blank tasks, and merges existing metadata for optional open tasks", async () => {
 m.findMany.mockResolvedValue([{ id: "done", executionStatus: "COMPLETED" }, { id: "open", executionStatus: "OPEN", metadata: { authored: "preserved" } }]);
 const result = await syncAdminJobTasks({ ...base, tasks: [{ title: " " }, { id: "done", title: "Historical" }, { id: "open", title: " Plant care ", description: " Conditional ", requiresNote: true, requiresPhoto: true, allowNotApplicable: true }] });
 expect(m.update).toHaveBeenCalledTimes(1); expect(m.create).not.toHaveBeenCalled();
 expect(m.update.mock.calls[0][0].data).toMatchObject({ title: "Plant care", description: "Conditional", metadata: { authored: "preserved", allowNotApplicable: true }, requiresPhoto: true, requiresNote: true });
 expect(result.canonicalTasks.map(t => t.id)).toEqual(["done", "open"]);
});
it.each([null, { status: "COMPLETED" }, { status: "ASSIGNED", assignments: [{ user: null }, { user: { id: "inactive", isActive: false } }] }])("does not notify missing/finished/unassigned work %j", async job => {
 m.job.mockResolvedValue(job); await notifyJobTasksAdded("j", ["Detail"]); expect(m.notify).not.toHaveBeenCalled();
});
it.each([1, 2])("notifies active cleaners with %i new tasks after the caller commits", async count => {
 m.job.mockResolvedValue({ id: "j", jobNumber: "JOB-1", status: "ASSIGNED", property: { name: "Home", suburb: count === 1 ? null : "Sydney" }, assignments: [{ user: { id: "c", isActive: true } }] });
 m.settings.mockResolvedValue({ companyName: count === 1 ? "Custom company" : "" });
 await notifyJobTasksAdded("j", Array.from({ length: count }, (_, i) => `Detail ${i}`));
 expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "job_task_added", jobId: "j", recipients: [{ id: "c", isActive: true }] }));
});
it("attaches pending requests through caller transaction or standalone database", async () => {
 const updateMany = vi.fn().mockResolvedValue({ count: 2 });
 expect(await attachPendingAdminTasksToJob({ jobId: "j", propertyId: "p", database: { jobTask: { updateMany } } as any })).toEqual({ attached: 2 });
 expect(m.updateMany).not.toHaveBeenCalled();
 m.updateMany.mockResolvedValue({ count: 0 });
 expect(await attachPendingAdminTasksToJob({ jobId: "j", propertyId: "p" })).toEqual({ attached: 0 });
 expect(updateMany.mock.calls[0][0].where).toMatchObject({ propertyId: "p", source: "ADMIN", jobId: null, executionStatus: "OPEN" });
});
