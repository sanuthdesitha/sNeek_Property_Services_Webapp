// @vitest-environment node
/**
 * The cleaner must acknowledge the guest timing before the job starts, the
 * acknowledgement must match the timing as it stands now, and a cleaner who
 * is already working re-confirms a changed time on the job screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { JobStatus, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), settings: vi.fn(), job: vi.fn(), update: vi.fn(), updateMany: vi.fn(), log: vi.fn(), logs: vi.fn(),
  createLog: vi.fn(), tasks: vi.fn(), assignment: vi.fn(), notify: vi.fn(), db: {} as Record<string, unknown>,
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: async () => [] }));
vi.mock("@/lib/notifications/client-job-notifications", () => ({ sendClientJobNotification: mocks.notify }));
vi.mock("@/lib/gps/ingest-service", () => ({ ingestCleanerBatch: vi.fn(async () => ({ status: 200, body: {} })) }));
vi.mock("@/lib/notifications/location-sharing", () => ({ sendCleanerSharingNotice: vi.fn(async () => []), sendStartWithoutFixNotice: vi.fn() }));
vi.mock("@/lib/cleaner/action-receipt", () => ({ ActionReceiptError: class extends Error {}, withCleanerAction: async (_context: unknown, run: (db: unknown) => unknown) => run(mocks.db) }));
vi.mock("@/lib/db", () => ({ get db() { return mocks.db; } }));

import { POST as start } from "@/app/api/cleaner/jobs/[id]/start/route";
import { POST as reconfirm } from "@/app/api/cleaner/jobs/[id]/briefing-ack/route";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { buildStartBriefingAck, resolveStartBriefingItems, startBriefingHash } from "@/lib/forms/start-briefing";

const AT = { lat: -33.86, lng: 151.2, accuracy: 8 };
const LATE_11 = serializeJobInternalNotes({ lateCheckout: { enabled: true, preset: "11:00" } });
const LATE_1230 = serializeJobInternalNotes({ lateCheckout: { enabled: true, preset: "12:30" } });

function itemsFor(notes: string | null) {
  return resolveStartBriefingItems({ meta: parseJobInternalNotes(notes), jobTasks: [] });
}
function jobRow(internalNotes: string | null, status: JobStatus = JobStatus.ASSIGNED) {
  return { id: "job", status, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2020-01-01"), internalNotes, property: { name: "Property", laundryEnabled: false } };
}
function post(handler: typeof start, path: string, body: unknown) {
  return handler(new NextRequest(`http://localhost/api/cleaner/jobs/job/${path}`, { method: "POST", body: JSON.stringify(body) }), { params: { id: "job" } });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER } });
  mocks.settings.mockResolvedValue({ timezone: "UTC", accountability: { requireJobStartConfirmation: true } });
  mocks.log.mockResolvedValue(null); mocks.logs.mockResolvedValue([]); mocks.tasks.mockResolvedValue([]);
  mocks.update.mockResolvedValue({}); mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.createLog.mockResolvedValue({ id: "log" }); mocks.notify.mockResolvedValue(undefined);
  mocks.assignment.mockResolvedValue({ id: "assignment", responseStatus: "ACCEPTED" });
  mocks.db = {
    jobAssignment: { findFirst: mocks.assignment },
    job: { findUnique: mocks.job, update: mocks.update, updateMany: mocks.updateMany },
    jobTask: { findMany: mocks.tasks },
    timeLog: { findFirst: mocks.log, findMany: mocks.logs, create: mocks.createLog },
    auditLog: { create: vi.fn() },
    locationTrackingNotice: { findUnique: async () => ({ id: "notice" }) },
    nfcScanEvent: { findFirst: async () => null },
  };
});

describe("start gate: guest timing must be acknowledged first", () => {
  it("refuses a first start without the timing acknowledgement and returns the items to read", async () => {
    mocks.job.mockResolvedValue(jobRow(LATE_11));
    const response = await post(start, "start", { propertyCodeConfirmed: true, startLocation: AT });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "START_BRIEFING_REQUIRED", reason: "MISSING" });
    expect(body.items[0]).toMatchObject({ source: "TIMING_RULE", title: expect.stringContaining("11:00") });
    expect(mocks.createLog).not.toHaveBeenCalled();
  });

  it("refuses an acknowledgement of the old time after the office changed it, before any clock starts", async () => {
    const shown = itemsFor(LATE_11);
    mocks.job.mockResolvedValue(jobRow(LATE_1230));
    const response = await post(start, "start", {
      propertyCodeConfirmed: true, startLocation: AT,
      startBriefingAck: shown.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(shown),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.reason).toBe("STALE");
    expect(body.items[0].title).toContain("12:30");
    expect(mocks.createLog).not.toHaveBeenCalled();
  });

  it("refuses a stored acknowledgement of the old time", async () => {
    const before = itemsFor(LATE_11);
    const stored = buildStartBriefingAck(before, before.map((item) => ({ itemId: item.id })));
    mocks.job.mockResolvedValue(jobRow(serializeJobInternalNotes({ ...parseJobInternalNotes(LATE_1230), startBriefingAcks: { cleaner: stored } })));
    const response = await post(start, "start", { propertyCodeConfirmed: true, startLocation: AT });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("STALE");
  });

  it("starts with the current acknowledgement and stores it with the timing fingerprint", async () => {
    const items = itemsFor(LATE_1230);
    mocks.job.mockResolvedValue(jobRow(LATE_1230));
    const response = await post(start, "start", {
      propertyCodeConfirmed: true, startLocation: AT,
      startBriefingAck: items.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(items),
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const written = mocks.update.mock.calls.map(([arg]) => arg.data.internalNotes).filter(Boolean);
    const ack = (parseJobInternalNotes(written[0]).startBriefingAcks as Record<string, { timingHash?: string }>).cleaner;
    expect(ack.timingHash).toBeTruthy();
    expect(mocks.createLog).toHaveBeenCalledTimes(1);
  });
});

describe("re-confirm a changed briefing while working", () => {
  it("records the reading of the current time, guarded on the notes it read", async () => {
    const items = itemsFor(LATE_1230);
    mocks.job.mockResolvedValue(jobRow(LATE_1230, JobStatus.IN_PROGRESS));
    const response = await post(reconfirm, "briefing-ack", {
      startBriefingAck: items.map((item) => ({ itemId: item.id, at: "2026-11-20T01:00:00.000Z" })), startBriefingHash: startBriefingHash(items),
    });
    expect(response.status).toBe(200);
    const [{ where, data }] = mocks.updateMany.mock.calls[0];
    expect(where).toEqual({ id: "job", internalNotes: LATE_1230 });
    const stored = (parseJobInternalNotes(data.internalNotes).startBriefingAcks as Record<string, { items: unknown[] }>).cleaner;
    expect(stored.items).toHaveLength(items.length);
  });

  it("refuses a reading of the old time and hands back the new list", async () => {
    const shown = itemsFor(LATE_11);
    mocks.job.mockResolvedValue(jobRow(LATE_1230, JobStatus.IN_PROGRESS));
    const response = await post(reconfirm, "briefing-ack", {
      startBriefingAck: shown.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(shown),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "START_BRIEFING_REQUIRED", reason: "STALE" });
    expect(body.items[0].title).toContain("12:30");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("writes nothing when the office saved a change while the cleaner was reading", async () => {
    const items = itemsFor(LATE_1230);
    mocks.job.mockResolvedValue(jobRow(LATE_1230, JobStatus.IN_PROGRESS));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await post(reconfirm, "briefing-ack", {
      startBriefingAck: items.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(items),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("BRIEFING_CHANGED");
  });

  it("refuses an administrator testing as the cleaner: the reading is the cleaner's own", async () => {
    mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER }, impersonation: { actorId: "admin", mode: "FULL" } });
    const items = itemsFor(LATE_1230);
    mocks.job.mockResolvedValue(jobRow(LATE_1230, JobStatus.IN_PROGRESS));
    const response = await post(reconfirm, "briefing-ack", {
      startBriefingAck: items.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(items),
    });
    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a cleaner who has not accepted the job, and a finished job", async () => {
    const items = itemsFor(LATE_1230);
    const body = { startBriefingAck: items.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(items) };
    mocks.assignment.mockResolvedValue({ id: "assignment", responseStatus: "PENDING" });
    mocks.job.mockResolvedValue(jobRow(LATE_1230));
    expect((await post(reconfirm, "briefing-ack", body)).status).toBe(409);
    mocks.assignment.mockResolvedValue({ id: "assignment", responseStatus: "ACCEPTED" });
    mocks.job.mockResolvedValue(jobRow(LATE_1230, JobStatus.SUBMITTED));
    expect((await post(reconfirm, "briefing-ack", body)).status).toBe(409);
    mocks.assignment.mockResolvedValue(null);
    expect((await post(reconfirm, "briefing-ack", body)).status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
