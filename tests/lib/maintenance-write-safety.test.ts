// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ item: vi.fn(), job: vi.fn(), tasks: vi.fn(), createTask: vi.fn(), updateItem: vi.fn(), cancel: vi.fn(), event: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { attachMaintenanceItemToJob, assignMaintenanceItem, setMaintenanceVisitState } from "@/lib/maintenance/workers";
beforeEach(() => {
 vi.resetAllMocks(); m.item.mockResolvedValue({ id: "m", propertyId: "p", property: { clientId: "c" }, title: "Repair", source: "ADMIN", status: "OPEN", assignedWorkerId: "worker" });
 m.job.mockResolvedValue({ propertyId: "p", status: "ASSIGNED" }); m.tasks.mockResolvedValue([]);
 m.transaction.mockImplementation(async fn => fn({ $executeRaw: m.lock, propertyMaintenanceItem: { findUnique: m.item, findUniqueOrThrow: m.item, update: m.updateItem }, job: { findUnique: m.job }, jobTask: { findMany: m.tasks, create: m.createTask, updateMany: m.cancel }, propertyMaintenanceEvent: { create: m.event } }));
});
it("does not attach cross-property work", async () => {
 m.job.mockResolvedValue({ propertyId: "other", status: "ASSIGNED" });
 await expect(attachMaintenanceItemToJob({ itemId: "m", jobId: "j" })).rejects.toThrow(/same property/); expect(m.updateItem).not.toHaveBeenCalled(); expect(m.createTask).not.toHaveBeenCalled();
});
it("failed task creation cannot leave a newly attached maintenance item", async () => {
 m.createTask.mockRejectedValue(new Error("write failed"));
 await expect(attachMaintenanceItemToJob({ itemId: "m", jobId: "j" })).rejects.toThrow("write failed"); expect(m.updateItem).not.toHaveBeenCalled(); expect(m.lock).toHaveBeenCalled();
});
it("repairs a same-job legacy attachment whose task is absent", async () => {
 m.item.mockResolvedValue({ id: "m", jobId: "j", propertyId: "p", title: "Repair", source: "ADMIN", property: {} });
 await attachMaintenanceItemToJob({ itemId: "m", jobId: "j" }); expect(m.createTask).toHaveBeenCalledTimes(1); expect(m.updateItem).toHaveBeenCalledTimes(1);
});
it("repeat attach reuses the task", async () => {
 m.tasks.mockResolvedValue([{ id: "task", jobId: "j", executionStatus: "OPEN" }]);
 await attachMaintenanceItemToJob({ itemId: "m", jobId: "j" }); expect(m.createTask).not.toHaveBeenCalled();
});
it("moving work cancels the old open task", async () => {
 m.tasks.mockResolvedValue([{ id: "old-task", jobId: "old", executionStatus: "OPEN" }]);
 await attachMaintenanceItemToJob({ itemId: "m", jobId: "new" }); expect(m.cancel.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["old-task"] } }, data: { executionStatus: "CANCELLED" } });
});
it("does not move already recorded task evidence", async () => {
 m.tasks.mockResolvedValue([{ id: "done", jobId: "old", executionStatus: "COMPLETED" }]);
 await expect(attachMaintenanceItemToJob({ itemId: "m", jobId: "new" })).rejects.toThrow(/work recorded/); expect(m.updateItem).not.toHaveBeenCalled();
});
it("rescheduling the same worker preserves visit evidence", async () => {
 await assignMaintenanceItem({ itemId: "m", workerId: "worker", scheduledFor: new Date() });
 expect(m.updateItem.mock.calls[0][0].data).not.toHaveProperty("clockInAt"); expect(m.updateItem.mock.calls[0][0].data.assignedAt).toBeUndefined();
});
it("replayed complete cannot overwrite completion time", async () => {
 m.item.mockResolvedValue({ status: "RESOLVED", resolvedAt: new Date(), clockInAt: new Date() });
 await expect(setMaintenanceVisitState({ itemId: "m", event: "COMPLETE" })).rejects.toThrow(/already been recorded/); expect(m.updateItem).not.toHaveBeenCalled();
});
it("completion requires recorded start, outcome and proof", async () => {
 await expect(setMaintenanceVisitState({ itemId: "m", event: "COMPLETE" })).rejects.toThrow(/Start the visit/);
 m.item.mockResolvedValue({ status: "IN_PROGRESS", clockInAt: new Date() });
 await expect(setMaintenanceVisitState({ itemId: "m", event: "COMPLETE" })).rejects.toThrow(/outcome and completion photo/); expect(m.updateItem).not.toHaveBeenCalled();
});

it("repeat worker assignment preserves timestamps and emits no new event",async()=>{
 const result=await assignMaintenanceItem({itemId:"m",workerId:"worker"});expect(result.unchanged).toBe(true);expect(m.updateItem).not.toHaveBeenCalled();expect(m.event).not.toHaveBeenCalled();
});
it("assigning a different worker clears old visit evidence and stamps the new assignment",async()=>{m.updateItem.mockResolvedValue({id:"m"});await assignMaintenanceItem({itemId:"m",workerId:"replacement",assignedByUserId:"admin"});expect(m.updateItem).toHaveBeenCalledWith({where:{id:"m"},data:expect.objectContaining({assignedWorkerId:"replacement",assignedAt:expect.any(Date),status:"ACKNOWLEDGED",enRouteAt:null,arrivedAt:null,workStartedAt:null,clockInAt:null,clockOutAt:null,outcome:null})});expect(m.event).toHaveBeenCalledTimes(1);});
