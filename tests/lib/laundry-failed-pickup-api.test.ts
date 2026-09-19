import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/laundry/[taskId]/status/route";
const m = vi.hoisted(() => ({ task: vi.fn(), record: vi.fn(), recipients: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "driver", role: "LAUNDRY" } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/db", () => ({ db: { laundryTask: { findUnique: m.task }, user: { findMany: m.recipients }, notification: { createMany: m.notify } } }));
vi.mock("@/lib/laundry/failed-pickup", () => ({ recordFailedPickup: m.record, FailedPickupError: class extends Error {} }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => key }));
beforeEach(() => { vi.resetAllMocks(); m.task.mockResolvedValue({ id: "task", jobId: "job", status: "CONFIRMED", property: { name: "House", laundryEnabled: true } }); m.record.mockResolvedValue({ id: "task", status: "FLAGGED", notificationStatus: "QUEUED" }); m.recipients.mockResolvedValue([{ id: "admin" }]); });
const request = (extra = {}) => POST(new NextRequest("http://localhost/api/laundry/task/status", { method: "POST", body: JSON.stringify({ status: "FAILED_PICKUP_REQUEST", confirm: true, requestedAction: "SKIP", failedPickupReason: "Locked gate", ...extra }) }), { params: { taskId: "task" } });
it("passes validated optional proof and existing request policy to the atomic service", async () => {
  const response = await request({ failedPickupPhotoKey: "laundry/failed-pickup/task/driver/abc.png" });
  expect(response.status).toBe(200);
  expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: "driver", taskId: "task", requestedAction: "SKIP", photoKey: "laundry/failed-pickup/task/driver/abc.png" }));
});
it("returns durable queued acknowledgement without a postcommit duplicate inbox write", async () => {
  m.notify.mockRejectedValue(new Error("delivery unavailable")); const response = await request();
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ id: "task", status: "FLAGGED", notificationStatus: "QUEUED" });
});
it("returns a stale conflict before attempting a report on a completed pickup", async () => {
  m.task.mockResolvedValue({ status: "PICKED_UP", property: { laundryEnabled: true } });
  expect((await request()).status).toBe(409); expect(m.record).not.toHaveBeenCalled();
});
