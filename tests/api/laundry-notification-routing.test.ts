// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/laundry/[taskId]/route";
import { DELETE } from "@/app/api/laundry/[taskId]/route";
const m = vi.hoisted(() => ({ task: vi.fn(), update: vi.fn(), users: vi.fn(), assigned: vi.fn(), notify: vi.fn(), audit: vi.fn(), evidence: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "actor", role: "ADMIN", email: "actor@example.invalid" } }) }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => key }));
vi.mock("@/lib/laundry/teams", () => ({ getAssignedLaundryUsersForProperty: m.assigned }));
vi.mock("@/lib/db", () => {
  const models = { laundryTask: { findUnique: m.task, update: m.update }, laundryConfirmation: { create: m.evidence }, auditLog: { create: m.audit },
    laundryRoute: { findMany: async () => [] }, user: { findMany: m.users }, notification: { createMany: m.notify } };
  return { db: { ...models, $transaction: async (write: (tx: typeof models) => Promise<unknown>) => write(models) } };
});
const context = { params: { taskId: "task" } };
const patch = () => PATCH(new NextRequest("http://localhost/api/admin/laundry/task", { method: "PATCH", body: JSON.stringify({ status: "SKIPPED_PICKUP", skipReasonCode: "NO_LINEN_USED" }) }), context);
const remove = () => DELETE(new NextRequest("http://localhost/api/laundry/task", { method: "DELETE", body: JSON.stringify({ mode: "SUPPRESS", reason: "Duplicate task" }) }), context);
beforeEach(() => {
  vi.clearAllMocks(); m.task.mockResolvedValue({ id: "task", jobId: "job", propertyId: "property", status: "PENDING", property: { id: "property", name: "House", laundryEnabled: true }, job: { id: "job", scheduledDate: new Date("2026-10-03") }, pickupDate: new Date("2026-10-03"), dropoffDate: new Date("2026-10-04") });
  m.update.mockResolvedValue({ id: "task", status: "SKIPPED_PICKUP" }); m.assigned.mockResolvedValue([{ id: "team-driver" }]); m.users.mockResolvedValue([{ id: "other-admin" }]);
});
it("targets a skipped pickup notice to assigned laundry users with laundry category", async () => {
  expect((await patch()).status).toBe(200);
  expect(m.assigned).toHaveBeenCalledWith("property"); expect(m.users).not.toHaveBeenCalled();
  expect(m.notify).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: "team-driver", jobId: "job", externalId: "mobile-outbox:pending:laundry", channel: "PUSH" })] });
});
it("does not broaden laundry recipients when no assigned users are returned", async () => {
  m.assigned.mockResolvedValue([]);
  expect((await patch()).status).toBe(200); expect(m.notify).not.toHaveBeenCalled(); expect(m.users).not.toHaveBeenCalled();
});
it("notifies other admins of suppression with laundry metadata after recording the audit", async () => {
  expect((await remove()).status).toBe(200);
  expect(m.users).toHaveBeenCalledWith({ where: { role: "ADMIN", isActive: true, id: { not: "actor" } }, select: { id: true } });
  expect(m.notify).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: "other-admin", jobId: "job", externalId: "mobile-outbox:pending:laundry", channel: "PUSH" })] });
  expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.notify.mock.invocationCallOrder[0]);
});
it("does not notify when the suppression transaction cannot complete", async () => {
  m.audit.mockRejectedValueOnce(new Error("audit unavailable"));
  expect((await remove()).status).toBe(400); expect(m.notify).not.toHaveBeenCalled();
});
