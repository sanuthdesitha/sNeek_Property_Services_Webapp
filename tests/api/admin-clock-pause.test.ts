// @vitest-environment node
/**
 * Administrator clock pause (Live ops, owner decision third set item 3):
 * POST /api/admin/jobs/[id]/pause-clock over lib/jobs/admin-clock-pause.ts,
 * which closes the cleaner's open log through the SAME clockOutCleaner the
 * cleaner's own Stop/Pause uses (same Job row lock, same duration formula,
 * same status rule).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(), job: vi.fn(), user: vi.fn(), transaction: vi.fn(), notice: vi.fn(),
  tx: {
    $queryRaw: vi.fn(), timeLog: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    job: { updateMany: vi.fn(), findUnique: vi.fn() }, auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, user: { findUnique: m.user }, $transaction: m.transaction } }));
vi.mock("@/lib/notifications/office-actions", () => ({ sendClockPausedNotice: m.notice }));

import { POST } from "@/app/api/admin/jobs/[id]/pause-clock/route";
import { pauseCleanerClockByOffice } from "@/lib/jobs/admin-clock-pause";

const NOW = new Date("2026-11-11T01:40:00.000Z");
const STARTED = new Date("2026-11-11T00:15:00.000Z"); // 85 minutes before NOW
const params = { params: { id: "job-1" } };
const body = { cleanerId: "cleaner-1", reason: "Left the property at 11:30 with the clock running", transports: ["PUSH"] };
const post = (data: unknown) => POST(new Request("http://localhost/api/admin/jobs/job-1/pause-clock", { method: "POST", body: JSON.stringify(data) }), params);

function asRole(role: "ADMIN" | "OPS_MANAGER", extra: Record<string, unknown> = {}) {
  m.auth.mockImplementation(async (roles: string[]) => {
    if (!roles.includes(role)) throw new Error("FORBIDDEN");
    return { user: { id: "admin-1", role }, ...extra };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  asRole("ADMIN");
  m.job.mockResolvedValue({ id: "job-1", jobNumber: "J-77", property: { name: "Glebe House" } });
  m.user.mockResolvedValue({ id: "cleaner-1", role: "CLEANER", name: "Aiko", email: "aiko@example.invalid" });
  m.transaction.mockImplementation(async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx));
  m.tx.timeLog.findFirst.mockResolvedValue({ id: "log-open", startedAt: STARTED, notes: "Started by NFC tap" });
  m.tx.timeLog.updateMany.mockResolvedValue({ count: 1 });
  m.tx.job.updateMany.mockResolvedValue({ count: 1 });
  m.tx.job.findUnique.mockResolvedValue({ status: "PAUSED" });
  m.tx.auditLog.create.mockResolvedValue({});
  m.notice.mockResolvedValue([{ userId: "cleaner-1", name: "Aiko", transport: "INBOX", path: "pipeline", state: "inbox_available" }]);
});

describe("pause-clock route: who may pause", () => {
  it("refuses an operations manager (ADMIN only)", async () => {
    asRole("OPS_MANAGER");
    const response = await post(body);
    expect(response.status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("refuses while impersonating, so the pause is recorded against the real person", async () => {
    asRole("ADMIN", { impersonation: { actorId: "real", mode: "FULL", startedAt: 1 } });
    expect((await post(body)).status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("requires a reason and an explicit transport", async () => {
    expect((await post({ ...body, reason: "  " })).status).toBe(400);
    expect((await post({ ...body, transports: [] })).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("answers 409 No running clock when the cleaner has no open log", async () => {
    m.tx.timeLog.findFirst.mockResolvedValue(null);
    const response = await post(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "No running clock" });
    expect(m.tx.timeLog.updateMany).not.toHaveBeenCalled();
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
    expect(m.notice).not.toHaveBeenCalled();
  });
});

describe("what a pause does", () => {
  it("closes only the open log, under the job row lock, with the shared duration formula and a marked note", async () => {
    const result = await pauseCleanerClockByOffice({ jobId: "job-1", cleanerId: "cleaner-1", reason: "Left site", actorId: "admin-1", transports: ["PUSH"], now: NOW });
    // The same lock the cleaner's Stop/Pause takes (clockOutCleaner).
    expect(m.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(String(m.tx.$queryRaw.mock.calls[0][0].join("?"))).toContain('FOR UPDATE');
    expect(m.tx.timeLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job-1", userId: "cleaner-1", stoppedAt: null } }));
    expect(m.tx.timeLog.updateMany).toHaveBeenCalledWith({
      where: { id: "log-open", stoppedAt: null },
      data: { stoppedAt: NOW, durationM: 85, notes: "Started by NFC tap | Paused by the office: Left site" },
    });
    // Recorded time is never rewritten or deleted.
    expect(m.tx.timeLog.update).not.toHaveBeenCalled();
    expect(m.tx.timeLog.delete).not.toHaveBeenCalled();
    expect(m.tx.timeLog.deleteMany).not.toHaveBeenCalled();
    // Status rule mirrors the cleaner's pause: IN_PROGRESS → PAUSED only.
    expect(m.tx.job.updateMany).toHaveBeenCalledWith({ where: { id: "job-1", status: "IN_PROGRESS", cleanSkipStatus: { not: "SKIPPED" } }, data: { status: "PAUSED" } });
    expect(result).toMatchObject({ timeLogId: "log-open", durationM: 85, jobStatus: "PAUSED", noticeError: null });
  });

  it("writes an audit row with who paused and why, and notifies the cleaner through the pipeline", async () => {
    await pauseCleanerClockByOffice({ jobId: "job-1", cleanerId: "cleaner-1", reason: "Left site", actorId: "admin-1", transports: ["PUSH", "EMAIL"], now: NOW });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "admin-1", jobId: "job-1", action: "ADMIN_CLOCK_PAUSE", entity: "TimeLog", entityId: "log-open",
      after: expect.objectContaining({ cleanerId: "cleaner-1", reason: "Left site", durationM: 85, jobStatusAfter: "PAUSED" }),
    }) });
    expect(m.notice).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", reason: "Left site", timeLogId: "log-open", transports: ["PUSH", "EMAIL"], cleaner: expect.objectContaining({ id: "cleaner-1" }) }));
  });

  it("does not double-close when the cleaner's own stop closed the log first", async () => {
    // The cleaner's stop won the row lock and closed the log: the guarded update matches nothing.
    m.tx.timeLog.updateMany.mockResolvedValue({ count: 0 });
    await expect(pauseCleanerClockByOffice({ jobId: "job-1", cleanerId: "cleaner-1", reason: "Left site", actorId: "admin-1", transports: ["PUSH"], now: NOW })).rejects.toMatchObject({ status: 409 });
    expect(m.tx.job.updateMany).not.toHaveBeenCalled();
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
    expect(m.notice).not.toHaveBeenCalled();
  });

  it("keeps the pause when the notice cannot be queued, and says so", async () => {
    m.notice.mockRejectedValue(new Error("pipeline down"));
    const result = await pauseCleanerClockByOffice({ jobId: "job-1", cleanerId: "cleaner-1", reason: "Left site", actorId: "admin-1", transports: ["PUSH"], now: NOW });
    expect(result.noticeError).toMatch(/could not be queued/);
    expect(m.tx.auditLog.create).toHaveBeenCalled();
  });

  it("returns the truthful notice states through the route", async () => {
    const response = await post(body);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.notice).toEqual([expect.objectContaining({ state: "inbox_available" })]);
    expect(JSON.stringify(json)).not.toMatch(/"delivered"|"sent"/);
  });
});
