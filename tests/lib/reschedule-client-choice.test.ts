// @vitest-environment node
/**
 * "Tell the client?" (board "Everyday dialogs and sheets", 2026-11): the
 * reschedule service skips the client's schedule email only when the person
 * answered No, keeps the automatic send when nobody was asked (bulk, Schedule
 * tab), and reports what happened. Cleaner notices never change.
 */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), guard: vi.fn(), audit: vi.fn(), assign: vi.fn(), notify: vi.fn(), lifecycle: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.find }, jobAssignment: { findMany: m.assign }, $transaction: m.transaction } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/phase3/branches", () => ({ getBranchById: vi.fn(), listBranches: vi.fn(), resolveBranchPropertyIds: vi.fn() }));
vi.mock("@/lib/ops/dispatch", () => ({ suggestAutoAssignment: vi.fn() }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.notify }));
import { applyReschedule, applyRescheduleWithNotice } from "@/lib/phase4/analytics";

let job: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  job = { id: "j", status: "ASSIGNED", scheduledDate: new Date("2026-10-03T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"), internalNotes: null, startTime: "10:00", dueTime: "12:00" };
  m.find.mockResolvedValue(job);
  m.guard.mockResolvedValue({ count: 1 });
  m.update.mockImplementation(async ({ data }) => ({ ...job, ...data }));
  m.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({ job: { update: m.update, updateMany: m.guard }, auditLog: { create: m.audit } }));
  m.assign.mockResolvedValue([{ user: { id: "cleaner", isActive: true } }]);
  m.notify.mockResolvedValue(undefined);
  m.lifecycle.mockResolvedValue({ sent: true, recipients: ["host@x"] });
});

it("No: the client's schedule email is skipped, the cleaners are still told", async () => {
  const { clientNotice } = await applyRescheduleWithNotice({ jobId: "j", date: "2026-10-04", userId: "admin", notifyClient: false });
  expect(m.lifecycle).not.toHaveBeenCalled();
  expect(m.notify).toHaveBeenCalledTimes(1);
  expect(clientNotice).toEqual({ status: "skipped_by_choice" });
});

it("Yes: the same gated send as before, reported with its recipients", async () => {
  const { clientNotice } = await applyRescheduleWithNotice({ jobId: "j", date: "2026-10-04", userId: "admin", notifyClient: true });
  expect(m.lifecycle).toHaveBeenCalledWith(expect.objectContaining({ stage: "SCHEDULE_UPDATED", mode: "auto" }));
  expect(clientNotice).toEqual({ status: "sent", recipients: ["host@x"] });
});

it("Yes with nobody to email reports why, in words", async () => {
  m.lifecycle.mockResolvedValue({ sent: false, recipients: [], skipped: "no-recipients" });
  const { clientNotice } = await applyRescheduleWithNotice({ jobId: "j", date: "2026-10-04", userId: "admin", notifyClient: true });
  expect(clientNotice).toEqual({ status: "not_sent", reason: "No client email on file." });
});

it("not asked (bulk reschedule, Schedule tab): unchanged automatic send and the job as before", async () => {
  const updated = await applyReschedule({ jobId: "j", date: "2026-10-04", userId: "admin" });
  expect(m.lifecycle).toHaveBeenCalledTimes(1);
  expect(updated).toMatchObject({ id: "j" });
});
