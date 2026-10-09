// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), updateMany: vi.fn(), update: vi.fn(), audit: vi.fn(), end: vi.fn(), sync: vi.fn(), notify: vi.fn(), settings: vi.fn(), unassign: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.read }, $transaction: (fn: any) => fn({ job: { updateMany: m.updateMany, update: m.update, findUniqueOrThrow: m.end }, auditLog: { create: m.audit }, jobAssignment: { updateMany: m.unassign } }) } }));
vi.mock("@/lib/job-tasks/service", () => ({ syncAdminJobTasks: m.sync, notifyJobTasksAdded: m.notify }));
vi.mock("@/lib/accountability/rotation", () => ({ applyJobRotationCompletion: vi.fn() }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: vi.fn() }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: vi.fn() }));
import { GET, PATCH } from "@/app/api/admin/jobs/[id]/route";
const timestamp = "2026-10-01T00:00:00.000Z";
let job: any;
beforeEach(() => { vi.resetAllMocks(); job = { id: "j", propertyId: "p", status: "COMPLETED", internalNotes: null, updatedAt: new Date(timestamp), completedAt: new Date(timestamp), scheduledDate: new Date(timestamp), startTime: "10:00", dueTime: "14:00", property: { clientId: "c", name: "Property" }, assignments: [] }; m.auth.mockResolvedValue({ user: { id: "admin" } }); m.read.mockResolvedValue(job); m.end.mockResolvedValue(job); m.updateMany.mockResolvedValue({ count: 1 }); m.sync.mockResolvedValue({ addedTitles: [], canonicalTasks: [] }); m.notify.mockResolvedValue(undefined); });
const patch = (body: any) => PATCH(new NextRequest("http://localhost/api/admin/jobs/j", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "j" } });
it.each([{ tags: ["detail"] }, { cleanerPayouts: { c: 0 } }, { fixedPrice: 50, invoiceNote: "invoice" }])("narrow edits preserve timing and precise completion %j", async body => {
  expect((await patch(body)).status).toBe(200);
  const data = m.updateMany.mock.calls[0][0].data;
  for (const key of ["startTime", "dueTime", "sameDayCheckin", "priorityBucket", "completedAt"]) expect(data).not.toHaveProperty(key);
});
it("rejects stale review before mutation", async () => {
  expect((await patch({ tags: ["x"], expectedUpdatedAt: "2026-09-01T00:00:00.000Z" })).status).toBe(409);
  expect(m.updateMany).not.toHaveBeenCalled();
});
it("guards concurrent update and does not sync after losing revision", async () => {
  m.updateMany.mockResolvedValue({ count: 0 });
  expect((await patch({ specialRequestTasks: [] })).status).toBe(409); expect(m.sync).not.toHaveBeenCalled();
});
it("rejects conflicting timing instead of silently clamping", async () => {
  expect((await patch({ earlyCheckin: { enabled: true, preset: "custom", time: "09:00" } })).status).toBe(400);
  expect(m.updateMany).not.toHaveBeenCalled();
});
it("reconciles explicit tasks in same transaction and writes canonical IDs", async () => {
  m.sync.mockResolvedValue({ addedTitles: ["Detail"], canonicalTasks: [{ id: "stable", title: "Detail", requiresPhoto: true }] });
  expect((await patch({ specialRequestTasks: [{ id: "draft", title: "Detail", requiresPhoto: true }] })).status).toBe(200);
  expect(m.sync.mock.calls[0][0].database).toBeDefined();
  expect(m.update.mock.calls[0][0].data.internalNotes).toContain("stable");
  expect(m.notify).toHaveBeenCalledWith("j", ["Detail"]);
});
it("explicit early-checkin save updates priority while preserving finished completion timestamp", async () => {
 expect((await patch({ earlyCheckin: { enabled: true, preset: "12:30" } })).status).toBe(200);
 const data = m.updateMany.mock.calls[0][0].data;
 expect(data).toMatchObject({ sameDayCheckin: true, sameDayCheckinTime: "12:30", dueTime: "12:30" });
 expect(data.priorityBucket).toBeDefined(); expect(data.completedAt).toBeUndefined();
});
it("explicit cancellation-only scope save passes no unrelated tasks", async () => {
 expect((await patch({ cancelTaskIds: ["queued"] })).status).toBe(200);
 expect(m.sync.mock.calls[0][0]).toMatchObject({ tasks: [], cancelTaskIds: ["queued"] });
});
it("unassignment removes active assignees in the same transaction", async () => {
 job.status = "ASSIGNED";
 expect((await patch({ status: "UNASSIGNED" })).status).toBe(200);
 expect(m.unassign).toHaveBeenCalledWith({ where: { jobId: "j", removedAt: null }, data: { removedAt: expect.any(Date), isPrimary: false } });
});
it("notification failure after commit returns success rather than inviting a duplicate save", async () => {
 job.status = "ASSIGNED";
 m.read.mockResolvedValueOnce(job).mockResolvedValueOnce({ ...job, dueTime: "15:00" });
 m.settings.mockRejectedValue(new Error("notification settings offline"));
 const log = vi.spyOn(console, "error").mockImplementation(() => {});
 try { expect((await patch({ dueTime: "15:00" })).status).toBe(200); expect(m.audit).toHaveBeenCalledOnce(); expect(log).toHaveBeenCalled(); } finally { log.mockRestore(); }
});
it.each([["UNAUTHORIZED",401],["FORBIDDEN",403]])("authorization denies %s before any mutation", async (message,status) => {
 m.auth.mockRejectedValue(new Error(String(message))); expect((await patch({ fixedPrice: 10 })).status).toBe(status); expect(m.updateMany).not.toHaveBeenCalled();
});


it.each([
  { role: "ADMIN", primaryRole: "ADMIN", allowed: true },
  { role: "OPS_MANAGER", primaryRole: "OPS_MANAGER", allowed: false },
  { role: "OPS_MANAGER", primaryRole: "ADMIN", allowed: false },
])("job rate navigation follows the effective role: %j", async ({ role, primaryRole, allowed }) => {
  m.auth.mockResolvedValue({ user: { id: "actor", role, primaryRole } });
  const response = await GET(new NextRequest("http://localhost/api/admin/jobs/j"), { params: { id: "j" } });
  expect(response.status).toBe(200);
  expect((await response.json()).capabilities).toEqual({ reviewHolidayRates: allowed });
});
