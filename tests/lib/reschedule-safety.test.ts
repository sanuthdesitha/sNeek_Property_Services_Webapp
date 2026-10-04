// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), guard: vi.fn(), audit: vi.fn(), assign: vi.fn(), notify: vi.fn(), lifecycle: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.find }, jobAssignment: { findMany: m.assign }, $transaction: m.transaction } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/phase3/branches", () => ({ getBranchById: vi.fn(), listBranches: vi.fn(), resolveBranchPropertyIds: vi.fn() }));
vi.mock("@/lib/ops/dispatch", () => ({ suggestAutoAssignment: vi.fn() }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.notify }));
import { applyReschedule } from "@/lib/phase4/analytics";
let job: any;
beforeEach(() => { vi.resetAllMocks(); job = { id: "j", status: "ASSIGNED", scheduledDate: new Date("2026-10-03T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"), internalNotes: null, startTime: "10:00", dueTime: "12:00" }; m.find.mockResolvedValue(job); m.guard.mockResolvedValue({ count: 1 }); m.update.mockImplementation(async ({ data }) => ({ ...job, ...data })); m.transaction.mockImplementation((fn: any) => fn({ job: { update: m.update, updateMany: m.guard }, auditLog: { create: m.audit } })); m.assign.mockResolvedValue([{ user: { id: "cleaner", isActive: true } }]); m.notify.mockResolvedValue(undefined); m.lifecycle.mockResolvedValue(undefined); });
it("unchanged schedule does not write or notify", async () => { await applyReschedule({ jobId: "j", date: "2026-10-03", userId: "admin" }); expect(m.transaction).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled(); });
it("changed schedule commits audit then informs cleaner and client without private reason in cleaner copy", async () => {
  await applyReschedule({ jobId: "j", date: "2026-10-04", userId: "admin", reason: "client-private" });
  expect(m.audit).toHaveBeenCalled(); expect(m.notify).toHaveBeenCalledTimes(1); expect(m.lifecycle).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(m.notify.mock.calls[0])).not.toContain("client-private");
});
it("rejects inverted times without mutation", async () => { await expect(applyReschedule({ jobId: "j", date: "2026-10-04", userId: "admin", startTime: "15:00", dueTime: "10:00" })).rejects.toThrow("valid start"); expect(m.transaction).not.toHaveBeenCalled(); });
it("does not notify for completed jobs", async () => { job.status = "COMPLETED"; await applyReschedule({ jobId: "j", date: "2026-10-04", userId: "admin" }); expect(m.notify).not.toHaveBeenCalled(); expect(m.lifecycle).not.toHaveBeenCalled(); });
it("rejects a stale revision", async () => { await expect(applyReschedule({ jobId: "j", date: "2026-10-04", userId: "admin", expectedUpdatedAt: "2026-09-01T00:00:00Z" })).rejects.toThrow("changed"); expect(m.transaction).not.toHaveBeenCalled(); });
