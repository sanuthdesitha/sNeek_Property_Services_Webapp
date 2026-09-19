import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { recordFailedPickup, validFailurePhotoKey } from "@/lib/laundry/failed-pickup";
const m = vi.hoisted(() => ({ head: vi.fn(), query: vi.fn(), task: vi.fn(), property: vi.fn(), update: vi.fn(), confirm: vi.fn(), audit: vi.fn(), recipients: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (run: any) => run({ $queryRaw: m.query, laundryTask: { findUnique: m.task, update: m.update }, property: { findUnique: m.property }, laundryConfirmation: { create: m.confirm }, auditLog: { create: m.audit }, user: { findMany: m.recipients } }) } }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://example.invalid/${key}`, resolveS3: async () => ({ client: { headObject: m.head }, bucket: "fixture" }) }));
vi.mock("@/lib/notifications/intent-store", () => ({ enqueueNotificationIntent: m.enqueue }));
const photoKey = "laundry/failed-pickup/task/driver/ab12.jpg";
const input = { taskId: "task", actorId: "driver", role: Role.LAUNDRY, status: "FAILED_PICKUP_REQUEST" as const, reason: "Gate locked", requestedAction: "SKIP" as const, photoKey };
beforeEach(() => { vi.resetAllMocks(); m.recipients.mockResolvedValue([]); m.confirm.mockResolvedValue({ id: "receipt" }); m.head.mockReturnValue({ promise: async () => ({ ContentType: "image/jpeg", ContentLength: 10 }) }); m.task.mockResolvedValue({ id: "task", jobId: "job", propertyId: "property", status: "PENDING", pickupDate: new Date("2026-09-13T00:00:00Z"), dropoffDate: new Date("2026-09-15T00:00:00Z") }); m.property.mockResolvedValue({ laundryEnabled: true, accessInfo: { laundryTeamUserIds: ["driver"] } }); m.update.mockResolvedValue({ id: "task", status: "FLAGGED" }); });
describe("access-failure reports", () => {
  it("binds photo ownership to task and actor and rejects path escapes", () => {
    expect(validFailurePhotoKey(photoKey, "task", "driver")).toBe(true);
    for (const key of [photoKey.replace("driver", "other"), photoKey.replace("task", "other"), "https://example.invalid/a.jpg", "laundry/failed-pickup/task/driver/../a.jpg"]) expect(validFailurePhotoKey(key, "task", "driver")).toBe(false);
  });
  it("persists verified proof with the approval event and audit without skipping the task", async () => {
    await recordFailedPickup(input);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FLAGGED" }) }));
    expect(m.confirm).toHaveBeenCalledWith({ data: expect.objectContaining({ s3Key: photoKey, photoUrl: `https://example.invalid/${photoKey}`, notes: expect.stringContaining('"approvalStatus":"PENDING"') }) });
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it("keeps photo optional and preserves same-day key-lost restrictions", async () => {
    await recordFailedPickup({ ...input, photoKey: undefined }); expect(m.head).not.toHaveBeenCalled();
    m.task.mockResolvedValue({ id: "task", propertyId: "property", status: "PENDING", pickupDate: new Date("2026-09-13T00:00:00Z"), dropoffDate: new Date("2026-09-13T00:00:00Z") });
    await expect(recordFailedPickup({ ...input, status: "FAILED_PICKUP_RESCHEDULE", date: "2026-09-14T00:00:00Z" })).rejects.toMatchObject({ status: 400 });
  });
  it("rejects stale status, changed team scope and invalid photo type without writing", async () => {
    m.task.mockResolvedValueOnce({ id: "task", propertyId: "property", status: "PICKED_UP" }); await expect(recordFailedPickup(input)).rejects.toMatchObject({ status: 409 });
    m.property.mockResolvedValueOnce({ laundryEnabled: true, accessInfo: { laundryTeamUserIds: ["other"] } }); await expect(recordFailedPickup(input)).rejects.toMatchObject({ status: 403 });
    m.head.mockReturnValue({ promise: async () => ({ ContentType: "video/mp4", ContentLength: 10 }) }); await expect(recordFailedPickup(input)).rejects.toMatchObject({ status: 400 });
    expect(m.update).not.toHaveBeenCalled();
  });
});
it("enqueues the existing office recipient inbox in the same transaction with receipt identity", async () => {
  m.recipients.mockResolvedValue([{ id: "admin", role: "ADMIN" }]); m.property.mockResolvedValue({ name: "House", laundryEnabled: true, accessInfo: { laundryTeamUserIds: ["driver"] } });
  expect(await recordFailedPickup(input)).toMatchObject({ notificationStatus: "QUEUED" });
  expect(m.enqueue).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ eventId: "receipt", eventKey: "laundry.failed_pickup", actorId: "driver", transport: "INBOX", recipient: { userId: "admin", role: "ADMIN", scope: { kind: "ADMIN_OPERATIONS" } } }));
  expect(m.recipients).toHaveBeenCalledWith({ where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true, id: { not: "driver" } }, select: { id: true, role: true } });
});
