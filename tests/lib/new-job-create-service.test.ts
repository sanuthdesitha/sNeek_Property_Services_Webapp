// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The New job page writes through the existing create service: same job row,
 * same follow-ups, plus three optional per-job choices and a request key.
 */
const m = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(), $queryRawUnsafe: vi.fn(),
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    job: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  return { tx, carry: vi.fn(), preferred: vi.fn(), lifecycle: vi.fn(), syncTasks: vi.fn(), audit: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: typeof m.tx) => unknown) => fn(m.tx),
    job: m.tx.job,
    auditLog: { create: m.audit },
    $queryRawUnsafe: m.tx.$queryRawUnsafe,
  },
}));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingCarryForwardTasksToJob: m.carry, syncAdminJobTasks: m.syncTasks }));
vi.mock("@/lib/jobs/preferred-cleaner", () => ({ assignPreferredCleanerIfAvailable: m.preferred }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
import {
  BOOKING_CONFIRMATION_SKIPPED_ACTION,
  NEW_JOB_RECEIPT_ACTION,
  NEW_JOB_RECEIPT_ENTITY,
  createAdminJob,
  createAdminJobOnce,
} from "@/lib/jobs/admin-create";

const body = { propertyId: "p1", jobType: "AIRBNB_TURNOVER" as const, scheduledDate: "2026-11-20T00:00:00.000Z", startTime: "10:00", dueTime: "15:00", estimatedHours: 3 };
const created = { id: "job-1", jobNumber: "J-100", propertyId: "p1", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date(body.scheduledDate), startTime: "10:00", isRework: false, internalNotes: null, property: { clientId: "c1" } };
const receipt = { key: "new-job:u1:abcdefgh-1234", userId: "u1", detail: { bodyHash: "h1" }, action: NEW_JOB_RECEIPT_ACTION, entity: NEW_JOB_RECEIPT_ENTITY };

beforeEach(() => {
  vi.resetAllMocks();
  m.tx.$queryRawUnsafe.mockResolvedValue([{ value: 100 }]);
  m.tx.job.create.mockResolvedValue(created);
  m.tx.job.update.mockResolvedValue(created);
  m.tx.auditLog.findFirst.mockResolvedValue(null);
  m.carry.mockResolvedValue({ attached: 2 });
  m.preferred.mockResolvedValue({ assigned: true, cleanerId: "tom" });
  m.lifecycle.mockResolvedValue({ sent: true, recipients: ["a@x.au"] });
  m.audit.mockResolvedValue({});
});

describe("parity: the New job request path creates what the old path creates", () => {
  it("writes the identical job row and runs the identical follow-ups", async () => {
    await createAdminJob(body);
    const oldData = m.tx.job.create.mock.calls[0][0].data;
    const oldCalls = { carry: m.carry.mock.calls[0][0], preferred: m.preferred.mock.calls[0][0], lifecycle: m.lifecycle.mock.calls[0][0] };
    vi.clearAllMocks();
    m.tx.job.create.mockResolvedValue(created);
    m.carry.mockResolvedValue({ attached: 2 });
    m.preferred.mockResolvedValue({ assigned: true, cleanerId: "tom" });
    m.lifecycle.mockResolvedValue({ sent: true, recipients: ["a@x.au"] });
    m.tx.auditLog.findFirst.mockResolvedValue(null);
    m.tx.$queryRawUnsafe.mockResolvedValue([{ value: 100 }]);
    const result = await createAdminJobOnce(body, receipt, { actor: { userId: "u1", name: "Admin" } });
    expect(m.tx.job.create.mock.calls[0][0].data).toEqual(oldData);
    expect(m.carry.mock.calls[0][0]).toEqual(oldCalls.carry);
    expect(m.preferred.mock.calls[0][0]).toEqual(oldCalls.preferred);
    expect(m.lifecycle.mock.calls[0][0]).toEqual(oldCalls.lifecycle);
    expect(m.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: NEW_JOB_RECEIPT_ACTION, entity: NEW_JOB_RECEIPT_ENTITY, entityId: receipt.key, jobId: "job-1" });
    expect(result.followUps).toEqual({ carryForwardAttached: 2, preferredCleaner: { outcome: "offered", cleanerId: "tom" }, bookingEmail: { outcome: "accepted", recipients: ["a@x.au"] } });
  });

  it("a double submit with the same key returns the first job and creates nothing", async () => {
    m.tx.auditLog.findFirst.mockResolvedValue({ jobId: "job-1", after: { bodyHash: "h1" } });
    m.tx.job.findUnique.mockResolvedValue({ id: "job-1", jobNumber: "J-100" });
    const result = await createAdminJobOnce(body, receipt);
    expect(result).toEqual({ jobId: "job-1", jobNumber: "J-100", replayed: true });
    expect(m.tx.job.create).not.toHaveBeenCalled();
    expect(m.preferred).not.toHaveBeenCalled();
    expect(m.lifecycle).not.toHaveBeenCalled();
    expect(m.tx.auditLog.findFirst.mock.calls[0][0].where).toEqual({ action: NEW_JOB_RECEIPT_ACTION, entity: NEW_JOB_RECEIPT_ENTITY, entityId: receipt.key });
  });

  it("says when a retry carried edits the first attempt did not have", async () => {
    m.tx.auditLog.findFirst.mockResolvedValue({ jobId: "job-1", after: { bodyHash: "older" } });
    m.tx.job.findUnique.mockResolvedValue({ id: "job-1", jobNumber: "J-100" });
    expect(await createAdminJobOnce(body, receipt)).toMatchObject({ replayed: true, changedSinceFirstAttempt: true });
  });
});

describe("per-job choices", () => {
  it("leave unassigned skips the preferred cleaner and nothing else", async () => {
    const result = await createAdminJobOnce(body, receipt, { skipPreferredCleaner: true, actor: { userId: "u1", name: null } });
    expect(m.preferred).not.toHaveBeenCalled();
    expect(m.carry).toHaveBeenCalledTimes(1);
    expect(m.lifecycle).toHaveBeenCalledTimes(1);
    expect(result.followUps?.preferredCleaner).toEqual({ outcome: "skipped_by_office" });
  });

  it("'Do not send for this job' sends nothing and records why", async () => {
    const result = await createAdminJobOnce(body, receipt, { sendBookingConfirmation: false, actor: { userId: "u1", name: null } });
    expect(m.lifecycle).not.toHaveBeenCalled();
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: BOOKING_CONFIRMATION_SKIPPED_ACTION, jobId: "job-1", userId: "u1" });
    expect(result.followUps?.bookingEmail).toEqual({ outcome: "switched_off" });
  });

  it("reports a booking email that was not accepted, never as sent", async () => {
    m.lifecycle.mockResolvedValue({ sent: false, recipients: [], skipped: "client-opted-out" });
    const result = await createAdminJobOnce(body, receipt);
    expect(result.followUps?.bookingEmail).toEqual({ outcome: "not_sent", reason: "client-opted-out" });
  });

  it("special tasks become JobTasks in the same transaction, recorded by the actor", async () => {
    m.syncTasks.mockResolvedValue({ addedTitles: ["Oven"], canonicalTasks: [{ id: "task-9", title: "Oven", requiresPhoto: true }] });
    await createAdminJobOnce({ ...body, specialRequestTasks: [{ title: "Oven", requiresPhoto: true }] }, receipt, { actor: { userId: "u1", name: "Admin" } });
    expect(m.tx.job.create.mock.calls[0][0].data).not.toHaveProperty("specialRequestTasks");
    expect(m.syncTasks.mock.calls[0][0]).toMatchObject({ jobId: "job-1", propertyId: "p1", clientId: "c1", actorUserId: "u1", database: m.tx });
    expect(JSON.parse(m.tx.job.update.mock.calls[0][0].data.internalNotes).specialRequestTasks[0]).toMatchObject({ id: "task-9", title: "Oven", requiresPhoto: true });
  });

  it("special tasks without an actor are refused before anything is written", async () => {
    await expect(createAdminJob({ ...body, specialRequestTasks: [{ title: "Oven" }] })).rejects.toThrow(/person creating the job/);
    expect(m.tx.job.create).not.toHaveBeenCalled();
  });

  it("a notice is stamped with the author like the job page's edit", async () => {
    await createAdminJobOnce({ ...body, notices: [{ body: "Cot in bedroom 2", urgency: "IMPORTANT" }] }, receipt, { actor: { userId: "u1", name: "Olivia" } });
    const meta = JSON.parse(m.tx.job.create.mock.calls[0][0].data.internalNotes);
    expect(meta.notices[0]).toMatchObject({ body: "Cot in bedroom 2", urgency: "IMPORTANT", authorName: "Olivia" });
    expect(meta.notices[0].createdAt).toBeTruthy();
  });
});
