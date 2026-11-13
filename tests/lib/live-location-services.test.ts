// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  assignment: vi.fn(),
  jobUpdate: vi.fn(),
  notice: vi.fn(),
  noticeUpsert: vi.fn(),
  user: vi.fn(),
  job: vi.fn(),
  setting: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({
  db: {
    jobAssignment: { findFirst: m.assignment },
    job: { update: m.jobUpdate },
    locationTrackingNotice: { findUnique: m.notice, upsert: m.noticeUpsert },
  },
}));

import { checkGeofenceForPing } from "@/lib/gps/geofence";
import { GET as noticeStatus, POST as acceptNotice } from "@/app/api/me/location-notice/route";
import { LOCATION_NOTICE_VERSION } from "@/lib/gps/notice";
import { clientSeesCleanerLocation, projectClientJob } from "@/lib/client/job-response";
import { indicatorCopy } from "@/components/v2/location/location-sharing-indicator";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";

const PROPERTY = { latitude: -33.86, longitude: 151.2, geofenceRadiusM: null };
beforeEach(() => vi.resetAllMocks());

describe("geofence judges the ping's own job", () => {
  it("looks up THIS job's assignment and stamps arrival only on a precise fix", async () => {
    m.assignment.mockResolvedValue({ job: { id: "job-a", status: "EN_ROUTE", arrivedAt: null, departedAt: null, property: PROPERTY } });
    await checkGeofenceForPing({ userId: "u", jobId: "job-a", lat: -33.86, lng: 151.2, accuracy: 500, pingAt: new Date() });
    expect(m.assignment.mock.calls[0][0].where).toEqual({ userId: "u", jobId: "job-a", removedAt: null });
    expect(m.jobUpdate).not.toHaveBeenCalled();
    expect(await checkGeofenceForPing({ userId: "u", jobId: "job-a", lat: -33.86, lng: 151.2, accuracy: 10, pingAt: new Date() })).toEqual({ arrived: { jobId: "job-a" } });
  });
  it("signals departure beyond the property's own radius plus hysteresis only", async () => {
    m.assignment.mockResolvedValue({ job: { id: "job-a", status: "IN_PROGRESS", arrivedAt: new Date(), departedAt: null, property: { ...PROPERTY, geofenceRadiusM: 300 } } });
    // ~220 m away: outside the 75 m default but inside this property's 300 m fence.
    expect(await checkGeofenceForPing({ userId: "u", jobId: "job-a", lat: -33.862, lng: 151.2, accuracy: 10, pingAt: new Date() })).toEqual({});
    expect((await checkGeofenceForPing({ userId: "u", jobId: "job-a", lat: -33.865, lng: 151.2, accuracy: 10, pingAt: new Date() })).departed?.jobId).toBe("job-a");
  });
  it("ignores a job outside the tracked statuses", async () => {
    m.assignment.mockResolvedValue({ job: { id: "job-b", status: "ASSIGNED", arrivedAt: null, departedAt: null, property: PROPERTY } });
    expect(await checkGeofenceForPing({ userId: "u", jobId: "job-b", lat: -33.86, lng: 151.2, accuracy: 5, pingAt: new Date() })).toEqual({});
    expect(m.jobUpdate).not.toHaveBeenCalled();
  });
});

describe("live-location notice acknowledgement", () => {
  const post = (body: unknown) => acceptNotice(new NextRequest("http://localhost/api/me/location-notice", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": "test" } }));
  it("reports the current version and records a versioned acknowledgement", async () => {
    m.role.mockResolvedValue({ user: { id: "c", role: "CLEANER" } });
    m.notice.mockResolvedValue(null);
    expect(await (await noticeStatus()).json()).toEqual({ portal: "CLEANER", version: LOCATION_NOTICE_VERSION, acknowledged: false, impersonating: false });
    m.noticeUpsert.mockResolvedValue({ acknowledgedAt: new Date("2026-11-13T00:00:00Z") });
    const res = await post({ version: LOCATION_NOTICE_VERSION });
    expect(res.status).toBe(200);
    expect(m.noticeUpsert.mock.calls[0][0]).toMatchObject({ where: { userId_version_portal: { userId: "c", version: LOCATION_NOTICE_VERSION, portal: "CLEANER" } }, update: {} });
  });
  it("refuses an old version and anyone viewing as the person", async () => {
    m.role.mockResolvedValue({ user: { id: "d", role: "LAUNDRY" } });
    expect((await post({ version: LOCATION_NOTICE_VERSION - 1 })).status).toBe(409);
    m.role.mockResolvedValue({ user: { id: "d", role: "LAUNDRY" }, impersonation: { actorId: "office", mode: "FULL", startedAt: 1 } });
    expect((await post({ version: LOCATION_NOTICE_VERSION })).status).toBe(403);
    expect(m.noticeUpsert).not.toHaveBeenCalled();
  });
});

describe("client sees the cleaner's position only with the per-client switch on", () => {
  const job = (client?: { showCleanerLiveLocation: boolean } | null) => ({
    status: "EN_ROUTE",
    cleanerLocationPings: [{ lat: 1, lng: 2, accuracy: 5, heading: null, speed: null, timestamp: new Date() }],
    property: { latitude: 3, longitude: 4, showCleanerContactToClient: false, client },
    assignments: [], report: null, invoiceLines: [], laundryTask: null, auditLogs: [],
  });
  const portal = { actor: "CLIENT" as const, permissions: { reports: true, invoicesView: true } as never, visibility: { showCleanerNames: true, showReports: true, showFinanceDetails: false, showReportDownloads: false } as never };
  it("defaults to off", () => {
    expect(clientSeesCleanerLocation(job(undefined))).toBe(false);
    expect(projectClientJob(job(undefined), portal, null).liveTrip).toBeNull();
    expect(projectClientJob(job({ showCleanerLiveLocation: false }), portal, null).liveTrip).toBeNull();
  });
  it("shows the live trip while on the way when switched on", () => {
    expect(projectClientJob(job({ showCleanerLiveLocation: true }), portal, null).liveTrip).toMatchObject({ cleanerLat: 1, cleanerLng: 2 });
  });
});

describe("tracking indicator wording", () => {
  it("says who can see it and states the platform limit", () => {
    expect(indicatorCopy({ portal: "cleaner", permission: "granted", clientSees: false })).toMatchObject({ tone: "info", title: "Your location is being shared with the office" });
    expect(indicatorCopy({ portal: "cleaner", permission: "granted", clientSees: true }).title).toContain("with the client");
    expect(indicatorCopy({ portal: "laundry", permission: "granted", clientSees: false }).detail).toContain("Keep the app open while driving");
    expect(indicatorCopy({ portal: "cleaner", permission: "denied", clientSees: false })).toMatchObject({ tone: "attention", title: "Location is off" });
  });
});

describe("JOB_OFFICE notification scope", () => {
  const reader = (role: string, levels: unknown) => ({
    user: { findUnique: vi.fn(async (args: { select: Record<string, unknown> }) => ("extraRoles" in args.select ? { extraRoles: [] } : { id: "x", role, isActive: true, clientId: null, laundrySupplierId: null })) },
    job: { findUnique: vi.fn(async () => ({ id: "job" })) },
    jobAssignment: { findFirst: vi.fn() },
    laundryTask: { findUnique: vi.fn() },
    appSetting: { findUnique: vi.fn(async () => (levels ? { value: levels } : null)) },
  });
  const recipient = (role: string) => ({ userId: "x", role, scope: { kind: "ENTITY", type: "JOB_OFFICE", id: "job" } }) as never;
  it("reaches administrators, and operations managers only with the Jobs pack", async () => {
    expect((await authorizeEntityRecipient(reader("ADMIN", null) as never, recipient("ADMIN"))).ok).toBe(true);
    const offPolicy = { revision: 1, presets: [], assignments: { x: { presetId: "existing", overrides: { jobs: "off" } } } };
    const onPolicy = { revision: 1, presets: [], assignments: { x: { presetId: "restricted", overrides: { jobs: "read" } } } };
    const off = await authorizeEntityRecipient(reader("OPS_MANAGER", offPolicy) as never, recipient("OPS_MANAGER"));
    const on = await authorizeEntityRecipient(reader("OPS_MANAGER", onPolicy) as never, recipient("OPS_MANAGER"));
    expect([off.ok, on.ok]).toEqual([false, true]);
    expect((await authorizeEntityRecipient(reader("CLEANER", null) as never, recipient("CLEANER"))).ok).toBe(false);
  });
});
