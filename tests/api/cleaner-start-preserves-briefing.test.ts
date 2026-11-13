// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { JobStatus, Role } from "@prisma/client";
const mocks = vi.hoisted(() => ({ role: vi.fn(), settings: vi.fn(), job: vi.fn(), update: vi.fn(),
  log: vi.fn(), logs: vi.fn(), createLog: vi.fn(), tasks: vi.fn(), audit: vi.fn(), notify: vi.fn(), db: {} as any }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: async () => [] }));
vi.mock("@/lib/notifications/client-job-notifications", () => ({ sendClientJobNotification: mocks.notify }));
// Live location 2026-11: after-commit side effects of a start are mocked.
vi.mock("@/lib/gps/ingest-service", () => ({ ingestCleanerBatch: vi.fn(async () => ({ status: 200, body: {} })) }));
vi.mock("@/lib/notifications/location-sharing", () => ({ sendCleanerSharingNotice: vi.fn(async () => []) }));
vi.mock("@/lib/cleaner/action-receipt", () => ({ ActionReceiptError: class extends Error {}, withCleanerAction: async (_context: unknown, run: any) => run(mocks.db) }));
import { POST } from "@/app/api/cleaner/jobs/[id]/start/route";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { resolveStartBriefingItems } from "@/lib/forms/start-briefing";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER } });
  mocks.settings.mockResolvedValue({ timezone: "UTC", accountability: { requireJobStartConfirmation: true } });
  mocks.log.mockResolvedValue(null); mocks.logs.mockResolvedValue([]); mocks.tasks.mockResolvedValue([]);
  mocks.update.mockResolvedValue({}); mocks.notify.mockResolvedValue(undefined);
  mocks.db = { jobAssignment: { findFirst: async () => ({ id: "assignment", responseStatus: "ACCEPTED" }) },
    job: { findUnique: mocks.job, update: mocks.update }, jobTask: { findMany: mocks.tasks },
    timeLog: { findFirst: mocks.log, findMany: mocks.logs, create: mocks.createLog }, auditLog: { create: mocks.audit },
    // The live-location notice is accepted and no tag was tapped, unless a test says otherwise.
    locationTrackingNotice: { findUnique: async () => ({ id: "notice" }) }, nfcScanEvent: { findFirst: async () => null } };
  mocks.createLog.mockResolvedValue({ id: "log" });
});
/** Where the cleaner is: required for every start and resume since live location 2026-11. */
const AT = { lat: -33.86, lng: 151.2, accuracy: 8 };
it("retains incoming briefing acknowledgement when first-start confirmation also writes metadata", async () => {
  const internalNotes = serializeJobInternalNotes({ internalNoteText: "Use the rear entrance" });
  mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2020-01-01"),
    internalNotes, property: { name: "Property", laundryEnabled: false } });
  const items = resolveStartBriefingItems({ meta: parseJobInternalNotes(internalNotes), jobTasks: [] });
  expect(items.length).toBeGreaterThan(0);
  const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({
    propertyCodeConfirmed: true, startBriefingAck: items.map(item => ({ itemId: item.id })), startLocation: AT,
  }) }), { params: { id: "job" } });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  const notes = mocks.update.mock.calls.map(([arg]) => arg.data.internalNotes).filter(Boolean);
  const last = parseJobInternalNotes(notes[notes.length - 1]) as any;
  expect(last.startBriefingAcks.cleaner).toBeTruthy();
  expect(last.startConfirmation.propertyCode).toBe(true);
  expect(last.internalNoteText).toBe("Use the rear entrance");
});

it("refuses a draft before starting the clock or notifying the client", async () => {
  mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, internalNotes: serializeJobInternalNotes({ isDraft: true }) });
  const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: "{}" }), { params: { id: "job" } });
  expect(response.status).toBe(409);
  expect(mocks.createLog).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
});

it("requires explicit QA rework acceptance before starting", async () => {
  mocks.db.jobAssignment.findFirst = vi.fn().mockResolvedValue({ id: "assignment", userId: "cleaner", responseStatus: "PENDING" });
  mocks.db.qaAssignment = { findFirst: vi.fn().mockResolvedValue({ reworkOfferStatus: "OFFERED" }) };
  mocks.job.mockResolvedValue({ id: "job", status: JobStatus.OFFERED, reworkOfJobId: "parent", internalNotes: null });
  const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: "{}" }), { params: { id: "job" } });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("REWORK_OFFER_RESPONSE_REQUIRED");
  expect(mocks.createLog).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("refuses a skipped clean before changing status or time logs", async () => {
 mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, cleanSkipStatus: "SKIPPED", internalNotes: null });
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: "{}" }), { params: { id: "job" } });
 expect(response.status).toBe(409); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.createLog).not.toHaveBeenCalled();
});
it("does not start when required briefing acknowledgement cannot persist", async () => {
 const internalNotes = serializeJobInternalNotes({ internalNoteText: "Use the rear entrance" });
 mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2020-01-01"), internalNotes, property: { name: "Property", laundryEnabled: false } });
 mocks.update.mockRejectedValue(new Error("write failed"));
 const items = resolveStartBriefingItems({ meta: parseJobInternalNotes(internalNotes), jobTasks: [] });
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({ propertyCodeConfirmed: true, startBriefingAck: items.map(item => ({ itemId: item.id })), startLocation: AT }) }), { params: { id: "job" } });
 expect(response.status).toBe(400); expect((await response.json()).error).toBe("write failed"); expect(mocks.createLog).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
});
it("records an explicit future-start confirmation and queues the jobs-category office notice", async () => {
 mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2099-01-01"), internalNotes: null, property: { name: "Property", laundryEnabled: false } });
 mocks.db.user = { findMany: vi.fn().mockResolvedValue([{ id: "admin" }]) };
 mocks.db.notification = { createMany: vi.fn() };
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({ propertyCodeConfirmed: true, allowFutureStart: true, startLocation: AT }) }), { params: { id: "job" } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.db.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({ subject: "Future job started early", externalId: "mobile-outbox:pending:jobs" });
 expect(mocks.createLog).toHaveBeenCalledTimes(1);
});
it("resumes a job an administrator paused: the closed log stays and a new log starts (Live ops Pause clock)", async () => {
 // lib/jobs/admin-clock-pause.ts closes the open log and moves IN_PROGRESS → PAUSED, exactly like the cleaner's own pause.
 mocks.job.mockResolvedValue({ id: "job", status: JobStatus.PAUSED, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2020-01-01"), internalNotes: null, property: { name: "Property", laundryEnabled: false } });
 mocks.log.mockResolvedValue(null); // no open log: the office closed it
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({ propertyCodeConfirmed: true, startLocation: AT }) }), { params: { id: "job" } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.createLog).toHaveBeenCalledTimes(1);
 expect(mocks.createLog.mock.calls[0][0].data).toMatchObject({ jobId: "job", userId: "cleaner" });
 expect(mocks.update.mock.calls.some(([arg]) => arg.data.status === JobStatus.IN_PROGRESS)).toBe(true);
});

// ── Live location at the start of every clock segment (2026-11) ──────────────
const farJob = (status: JobStatus = JobStatus.PAUSED) => ({ id: "job", status, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2020-01-01"), internalNotes: null,
  property: { name: "Property", laundryEnabled: false, latitude: -33.86, longitude: 151.2, geofenceRadiusM: null } });
const start = (body: unknown) => POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify(body) }), { params: { id: "job" } });

it("refuses a start until the current live-location notice is accepted", async () => {
  mocks.job.mockResolvedValue(farJob());
  mocks.db.locationTrackingNotice = { findUnique: async () => null };
  const response = await start({ propertyCodeConfirmed: true, startLocation: AT });
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe("LOCATION_NOTICE_REQUIRED");
  expect(mocks.createLog).not.toHaveBeenCalled();
});

it("refuses a start or resume without a location fix, unless this cleaner tapped the tag", async () => {
  mocks.job.mockResolvedValue(farJob());
  const refused = await start({ propertyCodeConfirmed: true });
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toBe("LOCATION_REQUIRED");
  expect(mocks.createLog).not.toHaveBeenCalled();
  mocks.db.nfcScanEvent = { findFirst: async () => ({ id: "tap" }) };
  expect((await start({ propertyCodeConfirmed: true })).status).toBe(200);
  expect(mocks.createLog.mock.calls[0][0].data).toMatchObject({ startLocationSource: "NFC", startLat: null });
});

it("judges THIS cleaner's segment off site (teammate or resume) and records nothing until a coded reason", async () => {
  mocks.job.mockResolvedValue(farJob());
  const away = { lat: -33.9, lng: 151.2, accuracy: 10 }; // ~4.4 km from the property
  const refused = await start({ propertyCodeConfirmed: true, startLocation: away });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: "OFF_SITE_REASON_REQUIRED", radiusM: 150 });
  expect(mocks.createLog).not.toHaveBeenCalled();
  const accepted = await start({ propertyCodeConfirmed: true, startLocation: { ...away, reasonCode: "KEY_PICKUP", note: "Collecting keys" } });
  expect(accepted.status).toBe(200);
  expect(mocks.createLog.mock.calls[0][0].data).toMatchObject({ startVerdict: "OFF_SITE", startReasonCode: "KEY_PICKUP", startNote: "Collecting keys", startLocationSource: "GPS" });
  expect(mocks.audit.mock.calls.some(([arg]) => arg.data.action === "CLOCK_START_OFF_SITE")).toBe(true);
});

it("stores an on-site start with distance and accuracy on the segment", async () => {
  mocks.job.mockResolvedValue(farJob());
  expect((await start({ propertyCodeConfirmed: true, startLocation: AT })).status).toBe(200);
  expect(mocks.createLog.mock.calls[0][0].data).toMatchObject({ startVerdict: "ON_SITE", startDistanceM: 0, startAccuracyM: 8 });
});

it("records no location while an administrator is viewing as the cleaner", async () => {
  mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER }, impersonation: { actorId: "office", mode: "FULL", startedAt: 1 } });
  mocks.db.locationTrackingNotice = { findUnique: async () => null };
  mocks.job.mockResolvedValue(farJob());
  expect((await start({ propertyCodeConfirmed: true })).status).toBe(200);
  expect(mocks.createLog.mock.calls[0][0].data).not.toHaveProperty("startLat");
});
