// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(), $queryRawUnsafe: vi.fn(),
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    job: { findUnique: vi.fn(), create: vi.fn() },
  };
  return { tx, carry: vi.fn(), preferred: vi.fn(), lifecycle: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: typeof m.tx) => unknown) => fn(m.tx), job: m.tx.job, $queryRawUnsafe: m.tx.$queryRawUnsafe } }));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingCarryForwardTasksToJob: m.carry }));
vi.mock("@/lib/jobs/preferred-cleaner", () => ({ assignPreferredCleanerIfAvailable: m.preferred }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
import { IMPORT_RECEIPT_ACTION, createAdminJobOnce } from "@/lib/jobs/admin-create";

const body = { propertyId: "p1", jobType: "DEEP_CLEAN" as const, scheduledDate: "2026-11-12T00:00:00.000Z", startTime: "10:00", dueTime: "14:00" };
const receipt = { key: "abc:2", userId: "admin", detail: { line: 2 } };
const created = { id: "job-1", jobNumber: "J-100", propertyId: "p1", jobType: "DEEP_CLEAN", scheduledDate: new Date(body.scheduledDate), startTime: "10:00", isRework: false, property: { clientId: "c1" } };

beforeEach(() => {
  vi.resetAllMocks();
  m.tx.$queryRawUnsafe.mockResolvedValue([{ value: 100 }]);
  m.tx.job.create.mockResolvedValue(created);
  m.lifecycle.mockResolvedValue(undefined);
});

describe("createAdminJobOnce (CSV import idempotency)", () => {
  it("creates the job and its receipt in one locked transaction, then runs the usual follow-ups once", async () => {
    m.tx.auditLog.findFirst.mockResolvedValue(null);
    const result = await createAdminJobOnce(body, receipt);
    expect(result).toMatchObject({ jobId: "job-1", jobNumber: "J-100", replayed: false });
    expect(m.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(m.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: IMPORT_RECEIPT_ACTION, entity: "JobImport", entityId: "abc:2", jobId: "job-1", userId: "admin" });
    expect(m.tx.job.create.mock.calls[0][0].data).toMatchObject({ propertyId: "p1", startTime: "10:00", dueTime: "14:00", jobType: "DEEP_CLEAN" });
    expect(m.carry).toHaveBeenCalledTimes(1);
    expect(m.preferred).toHaveBeenCalledTimes(1);
    expect(m.lifecycle).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", stage: "BOOKING_CONFIRMED", mode: "auto" }));
  });

  it("a retry that finds the receipt returns the same job and creates nothing", async () => {
    m.tx.auditLog.findFirst.mockResolvedValue({ jobId: "job-1" });
    m.tx.job.findUnique.mockResolvedValue({ id: "job-1", jobNumber: "J-100" });
    const result = await createAdminJobOnce(body, receipt);
    expect(result).toEqual({ jobId: "job-1", jobNumber: "J-100", replayed: true });
    expect(m.tx.job.create).not.toHaveBeenCalled();
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
    expect(m.carry).not.toHaveBeenCalled();
    expect(m.lifecycle).not.toHaveBeenCalled();
  });
});
