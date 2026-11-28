// @vitest-environment node
/**
 * Live plants (2026-11-28): at a property with live plants the start gate
 * reads out "This property has live plants…" on every job, and the server
 * refuses to start until it is acknowledged, exactly like the other briefing
 * items. The same list is fingerprinted by the start route and the
 * re-confirm route, so a reading made before the flag was on is stale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { JobStatus, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), settings: vi.fn(), job: vi.fn(), update: vi.fn(), updateMany: vi.fn(), log: vi.fn(), logs: vi.fn(),
  createLog: vi.fn(), tasks: vi.fn(), assignment: vi.fn(), notify: vi.fn(), db: {} as Record<string, unknown>,
  pilotOn: vi.fn(),
}));
// Pilot "Property reminders" (lib/pilots): on unless a test switches it off.
vi.mock("@/lib/pilots/state", () => ({ isPilotOn: mocks.pilotOn, loadPilotState: vi.fn() }));
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
import { LIVE_PLANTS_REMINDER_ID, LIVE_PLANTS_REMINDER_TEXT } from "@/lib/properties/property-reminders";

const AT = { lat: -33.86, lng: 151.2, accuracy: 8 };
const PLANTS: Features = { livePlants: true };
const NO_PLANTS: Features = { livePlants: false };

type Features = Record<string, boolean> | null;

function itemsFor(notes: string | null, features: Features) {
  return resolveStartBriefingItems({ meta: parseJobInternalNotes(notes), jobTasks: [], property: { features } });
}
function jobRow(internalNotes: string | null, features: Features, status: JobStatus = JobStatus.ASSIGNED) {
  return { id: "job", status, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2020-01-01"), internalNotes, property: { name: "Property", laundryEnabled: false, features } };
}
function post(handler: typeof start, path: string, body: unknown) {
  return handler(new NextRequest(`http://localhost/api/cleaner/jobs/job/${path}`, { method: "POST", body: JSON.stringify(body) }), { params: { id: "job" } });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pilotOn.mockImplementation(async (key: string) => key === "property-reminders");
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

describe("start gate: the live plants reminder", () => {
  it("refuses to start at a plants property without the reminder acknowledged, and returns it to read", async () => {
    mocks.job.mockResolvedValue(jobRow(null, PLANTS));
    const response = await post(start, "start", { propertyCodeConfirmed: true, startLocation: AT });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "START_BRIEFING_REQUIRED", reason: "MISSING" });
    expect(body.items).toEqual([expect.objectContaining({ id: LIVE_PLANTS_REMINDER_ID, source: "PROPERTY_REMINDER", title: LIVE_PLANTS_REMINDER_TEXT })]);
    expect(mocks.createLog).not.toHaveBeenCalled();
  });

  it("asks nothing at a property without live plants", async () => {
    mocks.job.mockResolvedValue(jobRow(null, NO_PLANTS));
    const response = await post(start, "start", { propertyCodeConfirmed: true, startLocation: AT });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(mocks.createLog).toHaveBeenCalledTimes(1);
  });

  it("refuses a stored acknowledgement made before the office marked the plants", async () => {
    const notes = serializeJobInternalNotes({ internalNoteText: "Spare key in the drawer" });
    const before = itemsFor(notes, NO_PLANTS);
    const stored = buildStartBriefingAck(before, before.map((item) => ({ itemId: item.id })));
    mocks.job.mockResolvedValue(jobRow(serializeJobInternalNotes({ ...parseJobInternalNotes(notes), startBriefingAcks: { cleaner: stored } }), PLANTS));
    const response = await post(start, "start", { propertyCodeConfirmed: true, startLocation: AT });
    expect(response.status).toBe(409);
    // The plant reminder was never read, so it is reported as missing.
    expect(await response.json()).toMatchObject({ code: "START_BRIEFING_REQUIRED", reason: "MISSING" });
    expect(mocks.createLog).not.toHaveBeenCalled();
  });

  it("starts once the reminder is acknowledged with the current list", async () => {
    const items = itemsFor(null, PLANTS);
    mocks.job.mockResolvedValue(jobRow(null, PLANTS));
    const response = await post(start, "start", {
      propertyCodeConfirmed: true, startLocation: AT,
      startBriefingAck: items.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(items),
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(mocks.createLog).toHaveBeenCalledTimes(1);
  });

  it("re-confirm while working fingerprints the same list, plants included", async () => {
    const withoutPlants = itemsFor(serializeJobInternalNotes({ internalNoteText: "Note" }), NO_PLANTS);
    mocks.job.mockResolvedValue(jobRow(serializeJobInternalNotes({ internalNoteText: "Note" }), PLANTS, JobStatus.IN_PROGRESS));
    const stale = await post(reconfirm, "briefing-ack", {
      startBriefingAck: withoutPlants.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(withoutPlants),
    });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.items.map((item: { id: string }) => item.id)).toContain(LIVE_PLANTS_REMINDER_ID);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("pilot \"Property reminders\" off: the start gate from before the pilot", () => {
  it("asks nothing at a plants property and starts, exactly as before", async () => {
    mocks.pilotOn.mockResolvedValue(false);
    mocks.job.mockResolvedValue(jobRow(null, PLANTS));
    const response = await post(start, "start", { propertyCodeConfirmed: true, startLocation: AT });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(mocks.pilotOn).toHaveBeenCalledWith("property-reminders", { userId: "cleaner", propertyId: undefined });
  });

  it("an acknowledgement given while the pilot was on still starts the job after it is switched off", async () => {
    const shown = itemsFor(serializeJobInternalNotes({ internalNoteText: "Note" }), PLANTS);
    mocks.pilotOn.mockResolvedValue(false);
    mocks.job.mockResolvedValue(jobRow(serializeJobInternalNotes({ internalNoteText: "Note" }), PLANTS));
    const response = await post(start, "start", {
      propertyCodeConfirmed: true, startLocation: AT,
      startBriefingAck: shown.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(shown),
    });
    // The list is now just the note: re-read once (never stuck), then it starts.
    expect([200, 409]).toContain(response.status);
    const fresh = itemsFor(serializeJobInternalNotes({ internalNoteText: "Note" }), null);
    const retry = await post(start, "start", {
      propertyCodeConfirmed: true, startLocation: AT,
      startBriefingAck: fresh.map((item) => ({ itemId: item.id })), startBriefingHash: startBriefingHash(fresh),
    });
    expect(retry.status, JSON.stringify(await retry.clone().json())).toBe(200);
  });
});
