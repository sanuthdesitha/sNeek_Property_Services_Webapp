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
    timeLog: { findFirst: mocks.log, findMany: mocks.logs, create: mocks.createLog }, auditLog: { create: mocks.audit } };
});
it("retains incoming briefing acknowledgement when first-start confirmation also writes metadata", async () => {
  const internalNotes = serializeJobInternalNotes({ internalNoteText: "Use the rear entrance" });
  mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2020-01-01"),
    internalNotes, property: { name: "Property", laundryEnabled: false } });
  const items = resolveStartBriefingItems({ meta: parseJobInternalNotes(internalNotes), jobTasks: [] });
  expect(items.length).toBeGreaterThan(0);
  const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({
    propertyCodeConfirmed: true, startBriefingAck: items.map(item => ({ itemId: item.id })),
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
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({ propertyCodeConfirmed: true, startBriefingAck: items.map(item => ({ itemId: item.id })) }) }), { params: { id: "job" } });
 expect(response.status).toBe(400); expect((await response.json()).error).toBe("write failed"); expect(mocks.createLog).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
});
it("records an explicit future-start confirmation and queues the jobs-category office notice", async () => {
 mocks.job.mockResolvedValue({ id: "job", status: JobStatus.ASSIGNED, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2099-01-01"), internalNotes: null, property: { name: "Property", laundryEnabled: false } });
 mocks.db.user = { findMany: vi.fn().mockResolvedValue([{ id: "admin" }]) };
 mocks.db.notification = { createMany: vi.fn() };
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/job/start", { method: "POST", body: JSON.stringify({ propertyCodeConfirmed: true, allowFutureStart: true }) }), { params: { id: "job" } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.db.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({ subject: "Future job started early", externalId: "mobile-outbox:pending:jobs" });
 expect(mocks.createLog).toHaveBeenCalledTimes(1);
});
