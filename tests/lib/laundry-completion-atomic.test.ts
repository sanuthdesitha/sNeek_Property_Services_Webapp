// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, PATCH } from "@/app/api/laundry/[taskId]/status/route";
const m = vi.hoisted(() => ({ role: "LAUNDRY", task: {} as any, locked: null as any, find: vi.fn(), update: vi.fn(), confirmation: vi.fn(), transaction: vi.fn(), property: undefined as any, editConfirmation: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async (roles: string[]) => {
  if (!roles.includes(m.role)) throw new Error("FORBIDDEN");
  return { user: { id: "driver", role: m.role } };
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ laundryPortalVisibility: { requireDropoffPhoto: false, requireEarlyDropoffReason: false } }) }));
vi.mock("@/lib/db", () => ({ db: {
  laundryTask: { findUnique: m.find }, $transaction: m.transaction,
  laundryRoute: { findMany: async () => [] },
} }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => key }));
const request = (overrides = {}) => POST(new NextRequest("http://localhost/api/laundry/task/status", { method: "POST", body: JSON.stringify({ status: "RETURNED", confirm: true, dropoffLocation: "Linen cupboard", ...overrides }) }), { params: { taskId: "task" } });
beforeEach(() => {
  vi.clearAllMocks(); m.role = "LAUNDRY"; m.locked = null; m.property = undefined; m.editConfirmation.mockResolvedValue({}); m.audit.mockResolvedValue({});
  m.task = { id: "task", propertyId: "p1", status: "PICKED_UP", updatedAt: new Date("2026-10-01"), dropoffDate: new Date("2026-10-01"), property: { laundryEnabled: true } };
  m.find.mockImplementation(async () => ({ ...m.task }));
  m.update.mockImplementation(async ({ data }) => ({ ...m.task, ...data }));
  m.confirmation.mockResolvedValue({ id: "receipt" });
  m.transaction.mockImplementation(async write => {
    let pending: any = null;
    const tx = {
      $queryRaw: async () => [],
      laundryTask: { findUnique: async () => m.locked ?? { ...m.task }, update: async (input: any) => { pending = await m.update(input); return pending; } },
      property: { findUnique: async () => m.property === undefined ? m.task.property : m.property },
      laundryConfirmation: { create: m.confirmation, update: m.editConfirmation },
      auditLog: { create: m.audit },
    };
    const value = await write(tx);
    if (pending) m.task = { ...pending, updatedAt: new Date() };
    return value;
  });
});
it("commits return state and its receipt together; repeated return cannot rewrite timestamp", async () => {
  expect((await request()).status).toBe(200);
  const first = m.task.droppedAt;
  expect(m.confirmation).toHaveBeenCalledTimes(1);
  expect((await request()).status).toBe(400);
  expect(m.update).toHaveBeenCalledTimes(1);
  expect(m.task.droppedAt).toEqual(first);
});
it("rejects a changed record after acquiring the lock", async () => {
  m.locked = { ...m.task, updatedAt: new Date("2026-10-02") };
  expect((await request()).status).toBe(409);
  expect(m.update).not.toHaveBeenCalled(); expect(m.confirmation).not.toHaveBeenCalled();
});
it("rolls back return state if evidence write fails", async () => {
  m.confirmation.mockRejectedValueOnce(new Error("receipt unavailable"));
  expect((await request()).status).toBe(400);
  expect(m.task.status).toBe("PICKED_UP"); expect(m.task.droppedAt).toBeUndefined();
});
it("does not let drivers revert or edit completed handoffs", async () => {
  expect((await request({ status: "REVERT_TO_CONFIRMED", notes: "Correction" })).status).toBe(403);
  const response = await PATCH(new NextRequest("http://localhost/api/laundry/task/status", { method: "PATCH", body: JSON.stringify({ confirm: true, notes: "Correction" }) }), { params: { taskId: "task" } });
  expect(response.status).toBe(403); expect(m.update).not.toHaveBeenCalled();
});
it("requires a reason for authorized administrative revert", async () => {
  m.role = "ADMIN";
  expect((await request({ status: "REVERT_TO_CONFIRMED" })).status).toBe(400);
  expect((await request({ status: "REVERT_TO_CONFIRMED", notes: "Wrong task picked" })).status).toBe(200);
  expect(m.task.status).toBe("CONFIRMED");
});

it("rejects an outdated version supplied by the action screen", async () => {
  expect((await request({ expectedUpdatedAt: "2026-09-01T00:00:00.000Z" })).status).toBe(409);
  expect(m.transaction).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});

it("rejects a driver when property access disappears while awaiting the task lock", async () => {
  m.property = { laundryEnabled: false };
  expect((await request()).status).toBe(403);
  expect(m.update).not.toHaveBeenCalled(); expect(m.confirmation).not.toHaveBeenCalled();
});
it("rejects a changed status even when its updated timestamp was unchanged", async () => {
  m.locked = { ...m.task, status: "DROPPED" };
  expect((await request()).status).toBe(409);
  expect(m.update).not.toHaveBeenCalled();
});
it("records an authorized return correction atomically without discarding pickup evidence", async () => {
  m.role = "OPS_MANAGER";
  const pickedUpAt = new Date("2026-10-01T10:00:00Z");
  m.task = { ...m.task, status: "DROPPED", pickedUpAt, droppedAt: new Date("2026-10-02") };
  expect((await request({ status: "REVERT_TO_PICKED_UP", notes: "Return entered on wrong task" })).status).toBe(200);
  expect(m.task).toMatchObject({ status: "PICKED_UP", droppedAt: null, pickedUpAt });
  expect(JSON.parse(m.confirmation.mock.calls[0][0].data.notes)).toEqual({ event: "REVERT_TO_PICKED_UP", notes: "Return entered on wrong task" });
});
const edit = (body = {}) => PATCH(new NextRequest("http://localhost/api/laundry/task/status", { method: "PATCH", body: JSON.stringify({ confirm: true, notes: "Correct measured weight", loadWeightKg: 4, ...body }) }), { params: { taskId: "task" } });
function completedTask() {
  m.role = "ADMIN";
  m.task = { ...m.task, status: "DROPPED", jobId: "job", confirmations: [
    { id: "pickup", notes: JSON.stringify({ event: "PICKED_UP", bagCount: 2 }) },
    { id: "drop", bagLocation: "Cupboard", notes: JSON.stringify({ event: "DROPPED", loadWeightKg: 3 }) },
  ] };
}
it("rejects stale administrative completion edits before opening a transaction", async () => {
  completedTask();
  expect((await edit({ expectedUpdatedAt: "2026-09-01T00:00:00.000Z" })).status).toBe(409);
  expect(m.transaction).not.toHaveBeenCalled(); expect(m.editConfirmation).not.toHaveBeenCalled();
});
it("commits corrected totals, evidence and the administrative audit in one transaction", async () => {
  completedTask();
  expect((await edit({ bagCount: 3, totalPrice: 25 })).status).toBe(200);
  expect(m.transaction).toHaveBeenCalledOnce();
  expect(m.task).toMatchObject({ bagWeightKg: 4, dropoffCostAud: 25 });
  expect(m.editConfirmation).toHaveBeenCalledTimes(2);
  expect(JSON.parse(m.confirmation.mock.calls[0][0].data.notes)).toMatchObject({ event: "EDIT_COMPLETED", reason: "Correct measured weight", changedFields: expect.arrayContaining(["bagCount", "loadWeightKg", "totalPrice"]) });
  expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "EDIT_LAUNDRY_COMPLETION", entityId: "task" }) });
});
it("does not commit corrected task data if its audit cannot be saved", async () => {
  completedTask(); m.audit.mockRejectedValueOnce(new Error("audit write failed"));
  expect((await edit()).status).toBe(400);
  expect(m.task.bagWeightKg).toBeUndefined();
});
it("rejects a stale revision discovered inside the administrative edit transaction", async () => {
  completedTask(); m.locked = { ...m.task, updatedAt: new Date("2026-10-02") };
  expect((await edit()).status).toBe(409);
  expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
