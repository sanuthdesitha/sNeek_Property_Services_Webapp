// @vitest-environment node
/**
 * Smart property reminder routes (item 9, slice A): the office routes guard
 * ADMIN / OPS_MANAGER on the live session (pack checked inside requireRole),
 * refuse writes while testing as someone, and record the role acted as; the
 * cleaner's confirmation route needs the live CLEANER role, an assignment,
 * the reminder current for this job and person, and refuses impersonation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  patch: vi.fn(),
  assignment: vi.fn(),
  job: vi.fn(),
  ack: vi.fn(),
  source: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/pilots/gates", () => ({ reminderSource: mocks.source }));
vi.mock("@/lib/db", () => ({ db: { jobAssignment: { findFirst: mocks.assignment }, job: { findUnique: mocks.job }, propertyReminderAck: { upsert: mocks.ack } } }));
vi.mock("@/lib/properties/reminders/service", () => {
  class ReminderServiceError extends Error {
    constructor(public status: number, message: string, public code: string) {
      super(message);
    }
  }
  return { listPropertyReminders: mocks.list, createPropertyReminder: mocks.create, patchPropertyReminder: mocks.patch, ReminderServiceError };
});

import { GET as listRoute, POST as createRoute } from "@/app/api/admin/properties/[id]/reminders/route";
import { PATCH as patchRoute } from "@/app/api/admin/properties/[id]/reminders/[reminderId]/route";
import { POST as ackRoute } from "@/app/api/cleaner/jobs/[id]/reminders/ack/route";
import { ReminderServiceError } from "@/lib/properties/reminders/service";

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/x", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const office = (role: Role, extra: Record<string, unknown> = {}) => ({ user: { id: `${role}-1`, role }, ...extra });
const valid = { text: "Wipe the rangehood", moment: "BEFORE_START", lifetime: "EVERY_JOB" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ id: "rem-1" });
  mocks.patch.mockResolvedValue({ id: "rem-1", updatedAt: "2026-11-28T00:00:00.000Z" });
  mocks.list.mockResolvedValue({ active: [], ended: [], cleaners: [], pilot: "OFF", todayKey: "2026-11-28" });
});

describe("office: /api/admin/properties/[id]/reminders", () => {
  it("asks requireRole for ADMIN or OPS_MANAGER on every call and answers 401/403 from it", async () => {
    mocks.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await listRoute(request("GET"), { params: { id: "p1" } })).status).toBe(401);
    mocks.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await createRoute(request("POST", valid), { params: { id: "p1" } })).status).toBe(403);
    mocks.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await patchRoute(request("PATCH", { action: "end" }), { params: { id: "p1", reminderId: "r1" } })).status).toBe(403);
    expect(mocks.role.mock.calls.every(([roles]) => JSON.stringify(roles) === JSON.stringify([Role.ADMIN, Role.OPS_MANAGER]))).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("lists for an operations manager with the pack (requireRole passed)", async () => {
    mocks.role.mockResolvedValue(office(Role.OPS_MANAGER));
    const response = await listRoute(request("GET"), { params: { id: "p1" } });
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("p1");
  });

  it("refuses to write while testing as another person", async () => {
    mocks.role.mockResolvedValue(office(Role.ADMIN, { impersonation: { actorId: "admin-real", mode: "FULL", startedAt: 1 } }));
    expect((await createRoute(request("POST", valid), { params: { id: "p1" } })).status).toBe(403);
    expect((await patchRoute(request("PATCH", { action: "end", expectedUpdatedAt: "2026-11-28T00:00:00.000Z" }), { params: { id: "p1", reminderId: "r1" } })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("records the role acted as: ADMIN and OPS_MANAGER are kept apart", async () => {
    mocks.role.mockResolvedValueOnce(office(Role.ADMIN));
    expect((await createRoute(request("POST", valid), { params: { id: "p1" } })).status).toBe(201);
    mocks.role.mockResolvedValueOnce(office(Role.OPS_MANAGER));
    await createRoute(request("POST", valid), { params: { id: "p1" } });
    expect(mocks.create.mock.calls.map(([actor]) => actor)).toEqual([
      { id: "ADMIN-1", role: Role.ADMIN },
      { id: "OPS_MANAGER-1", role: Role.OPS_MANAGER },
    ]);
  });

  it("passes service refusals through (conflict, not found) and answers 400 for a bad body", async () => {
    mocks.role.mockResolvedValue(office(Role.ADMIN));
    mocks.patch.mockRejectedValueOnce(new ReminderServiceError(409, "Someone changed this reminder.", "CONFLICT"));
    const conflict = await patchRoute(request("PATCH", { action: "end", expectedUpdatedAt: "2026-11-28T00:00:00.000Z" }), { params: { id: "p1", reminderId: "r1" } });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("CONFLICT");
    const bad = await createRoute(new NextRequest("http://localhost/api/x", { method: "POST", body: "{" }), { params: { id: "p1" } });
    expect(bad.status).toBe(400);
  });
});

describe("cleaner: POST /api/cleaner/jobs/[id]/reminders/ack", () => {
  const cleaner = { user: { id: "cleaner-1", role: Role.CLEANER } };
  const item = { key: "office:r1", briefingId: "property-reminder-office-r1", text: "Check the balcony door", why: "From the office", moment: "BEFORE_LEAVING", roomKey: null, mustConfirm: true, rank: 1, createdAt: "2026-11-01T00:00:00.000Z" };

  beforeEach(() => {
    mocks.role.mockResolvedValue(cleaner);
    mocks.assignment.mockResolvedValue({ id: "assignment-1" });
    mocks.job.mockResolvedValue({ id: "job-1", status: "IN_PROGRESS", propertyId: "p1", property: { features: null } });
    mocks.source.mockResolvedValue({ reminders: [item] });
    mocks.ack.mockResolvedValue({ reminderKey: "office:r1", acknowledgedAt: new Date("2026-11-28T01:00:00Z") });
  });

  it("guards with the live CLEANER role", async () => {
    mocks.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } })).status).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith([Role.CLEANER]);
  });

  it("refuses while an administrator is testing as the cleaner", async () => {
    mocks.role.mockResolvedValue({ ...cleaner, impersonation: { actorId: "admin", mode: "FULL", startedAt: 1 } });
    expect((await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } })).status).toBe(403);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it("refuses a cleaner not on the job, and a finished job", async () => {
    mocks.assignment.mockResolvedValueOnce(null);
    expect((await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } })).status).toBe(403);
    mocks.job.mockResolvedValueOnce({ id: "job-1", status: "SUBMITTED", propertyId: "p1", property: null });
    expect((await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } })).status).toBe(409);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it("pilot off or reminder no longer current: refused, nothing recorded", async () => {
    mocks.source.mockResolvedValueOnce(null);
    const off = await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } });
    expect(off.status).toBe(409);
    expect((await off.json()).code).toBe("REMINDER_NOT_CURRENT");
    mocks.source.mockResolvedValueOnce({ remindersUnavailable: true });
    expect((await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } })).status).toBe(503);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it("records the confirmation for this job and person with the text shown, idempotently", async () => {
    const response = await ackRoute(request("POST", { reminderKey: "office:r1" }), { params: { id: "job-1" } });
    expect(response.status).toBe(200);
    expect(mocks.source).toHaveBeenCalledWith({ features: null }, { userId: "cleaner-1", propertyId: "p1" }, "job-1");
    expect(mocks.ack).toHaveBeenCalledWith(expect.objectContaining({
      where: { reminderKey_jobId_userId: { reminderKey: "office:r1", jobId: "job-1", userId: "cleaner-1" } },
      create: { reminderKey: "office:r1", jobId: "job-1", userId: "cleaner-1", moment: "BEFORE_LEAVING", text: "Check the balcony door" },
      update: {},
    }));
  });
});
