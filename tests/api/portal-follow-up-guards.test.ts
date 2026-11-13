// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  session: vi.fn(),
  portal: vi.fn(),
  gateway: vi.fn(),
  scope: vi.fn(),
  db: {
    job: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    jobAssignment: { findFirst: vi.fn() },
    timeLog: { findMany: vi.fn(), findFirst: vi.fn() },
    userLastLocation: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    clientInvoice: { findFirst: vi.fn() },
    cleanerLocationPing: { create: vi.fn(), createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })) },
    laundryRoute: { findFirst: vi.fn(), update: vi.fn() },
    laundryTask: { findUnique: vi.fn(), findFirst: vi.fn() },
    property: { findUnique: vi.fn(), findMany: vi.fn() },
    stockRun: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role, requireSession: m.session }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: m.portal }));
vi.mock("@/lib/payments/service", () => ({ getPrimaryGateway: m.gateway, createPaymentAdapter: vi.fn() }));
vi.mock("@/lib/laundry/teams", () => ({ laundryTaskScope: m.scope }));
vi.mock("@/lib/gps/geofence", () => ({ checkGeofenceForPing: vi.fn(async () => ({ departed: undefined })) }));
vi.mock("@/lib/gps/departure-clockout", () => ({ handleGeofenceDeparture: vi.fn() }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ createContinuationRequest: vi.fn(), listContinuationRequests: vi.fn() }));

import { POST as approvalRequest } from "@/app/api/cleaner/jobs/[id]/approval-request/route";
import { POST as continuationRequest } from "@/app/api/cleaner/jobs/[id]/reschedule-request/route";
import { POST as cleanerPing } from "@/app/api/cleaner/location/ping/route";
import { POST as laundryPing } from "@/app/api/laundry/location/ping/route";
import { POST as payInvoice } from "@/app/api/client/invoices/[id]/pay/route";
import { listStockRuns } from "@/lib/inventory/stock-runs";

const post = (body: unknown) =>
  new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
const ctx = { params: { id: "job" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "user", role: "CLEANER" } });
});

describe("cleaner requests are bound to an open job", () => {
  it.each(["COMPLETED", "INVOICED"])("refuses an extra-pay approval request on a %s job", async (status) => {
    m.db.job.findUnique.mockResolvedValue({ id: "job", status, assignments: [{ userId: "user", removedAt: null }], property: {} });
    const res = await approvalRequest(post({ title: "Extra oven", amount: 40 }), ctx);
    expect(res.status).toBe(409);
  });

  it.each(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"])("refuses a continuation request on a %s job", async (status) => {
    m.db.jobAssignment.findFirst.mockResolvedValue({ id: "assignment" });
    m.db.job.findUnique.mockResolvedValue({ status });
    const res = await continuationRequest(post({ reason: "Need more time" }), ctx);
    expect(res.status).toBe(409);
    expect(m.db.timeLog.findMany).not.toHaveBeenCalled();
  });
});

describe("location pings", () => {
  // Live location 2026-11: one ingest path (lib/gps/ingest-service) behind the
  // tracking window; refused fixes are counted under a reason.
  it("drops a cleaner ping dated ahead of the server clock", async () => {
    m.role.mockResolvedValue({ user: { id: `cleaner-${Math.random()}`, role: "CLEANER" } });
    m.db.job.findFirst.mockResolvedValue({ id: "job", status: "EN_ROUTE", scheduledDate: new Date(), cleanSkipStatus: "NONE", property: { name: "P", latitude: null, longitude: null, geofenceRadiusM: null, client: { showCleanerLiveLocation: false } } });
    m.db.timeLog.findFirst.mockResolvedValue(null);
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const res = await cleanerPing(post({ jobId: "job", lat: -33.8, lng: 151.2, timestamp: future }));
    expect(await res.json()).toMatchObject({ received: 0, dropped: 1, dropReasons: { FUTURE: 1 } });
    expect(m.db.cleanerLocationPing.createMany).not.toHaveBeenCalled();
  });

  it("files a driver's ping against the next stop of their own ACTIVE route today", async () => {
    m.role.mockResolvedValue({ user: { id: `driver-${Math.random()}`, role: "LAUNDRY" } });
    m.db.laundryRoute.findFirst.mockResolvedValue({
      id: "route", status: "ACTIVE", date: new Date(),
      stops: [{ taskId: "own-task", kind: "PICKUP", order: 0, propertyId: "p1" }],
    });
    m.db.laundryTask.findUnique.mockResolvedValue({ jobId: "own-job" });
    m.db.property.findUnique.mockResolvedValue(null);
    const res = await laundryPing(post({ lat: -33.8, lng: 151.2 }));
    expect(res.status).toBe(200);
    expect(m.db.laundryTask.findUnique).toHaveBeenCalledWith({ where: { id: "own-task" }, select: { jobId: true } });
    expect(m.db.cleanerLocationPing.createMany.mock.calls[0][0].data[0]).toMatchObject({ jobId: "own-job", laundryRouteId: "route", source: "LAUNDRY_ROUTE" });
    expect(m.db.laundryTask.findFirst).not.toHaveBeenCalled();
  });

  it("stores nothing for a driver without an active route (no fallback to unrelated tasks)", async () => {
    m.role.mockResolvedValue({ user: { id: `driver-${Math.random()}`, role: "LAUNDRY" } });
    m.db.laundryRoute.findFirst.mockResolvedValue(null);
    const res = await laundryPing(post({ lat: -33.8, lng: 151.2 }));
    expect(await res.json()).toMatchObject({ received: 0, dropReasons: { OUTSIDE_WINDOW: 1 }, window: { active: false, reason: "NO_ACTIVE_ROUTE" } });
    expect(m.db.laundryTask.findFirst).not.toHaveBeenCalled();
    expect(m.db.cleanerLocationPing.createMany).not.toHaveBeenCalled();
  });

  it("never records an office account or an impersonated driver", async () => {
    m.db.laundryRoute.findFirst.mockResolvedValue({ id: "route", status: "ACTIVE", date: new Date(), stops: [{ taskId: "t", kind: "PICKUP", order: 0, propertyId: "p1" }] });
    m.role.mockResolvedValue({ user: { id: `admin-${Math.random()}`, role: "ADMIN" } });
    expect(await (await laundryPing(post({ lat: -33.8, lng: 151.2 }))).json()).toMatchObject({ received: 0, window: { reason: "WRONG_ROLE" } });
    m.role.mockResolvedValue({ user: { id: `driver-${Math.random()}`, role: "LAUNDRY" }, impersonation: { actorId: "office", mode: "FULL", startedAt: 1 } });
    expect(await (await laundryPing(post({ lat: -33.8, lng: 151.2 }))).json()).toMatchObject({ received: 0, dropReasons: { IMPERSONATING: 1 } });
    expect(m.db.cleanerLocationPing.createMany).not.toHaveBeenCalled();
  });
});

describe("client finance and stock switches", () => {
  it("refuses to open a payment when invoices are hidden for this client", async () => {
    m.role.mockResolvedValue({ user: { id: "client-user", role: "CLIENT" } });
    m.portal.mockResolvedValue({ visibility: { showFinanceDetails: false } });
    const res = await payInvoice(post({ returnUrl: "http://localhost/v2/client/invoices" }), ctx);
    expect(res.status).toBe(403);
    expect(m.db.clientInvoice.findFirst).not.toHaveBeenCalled();
    expect(m.gateway).not.toHaveBeenCalled();
  });

  it("lets a client edit thresholds only with the switch, and never returns the requester's email", async () => {
    m.db.property.findMany.mockResolvedValue([{ id: "p1", name: "House", suburb: null, clientId: "c1" }]);
    m.db.stockRun.findMany.mockResolvedValue([
      { id: "run", requestedBy: { id: "u", name: "Sam", email: "sam@example.com", role: "CLEANER" } },
    ]);
    const off = await listStockRuns({ role: "CLIENT" as any, userId: "client-user", clientId: "c1" });
    expect(off.canEditThresholds).toBe(false);
    expect(off.runs[0].requestedBy).toMatchObject({ name: "Sam", email: "" });
    const on = await listStockRuns({ role: "CLIENT" as any, userId: "client-user", clientId: "c1", thresholdEdits: true });
    expect(on.canEditThresholds).toBe(true);
    const office = await listStockRuns({ role: "ADMIN" as any, userId: "admin" });
    expect(office.runs[0].requestedBy.email).toBe("sam@example.com");
  });
});
