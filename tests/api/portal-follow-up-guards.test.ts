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
    job: { findUnique: vi.fn(), findMany: vi.fn() },
    jobAssignment: { findFirst: vi.fn() },
    timeLog: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    clientInvoice: { findFirst: vi.fn() },
    cleanerLocationPing: { create: vi.fn(), createMany: vi.fn() },
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
  it("drops a cleaner ping dated ahead of the server clock", async () => {
    m.session.mockResolvedValue({ user: { id: `cleaner-${Math.random()}` } });
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const res = await cleanerPing(post({ jobId: "job", lat: -33.8, lng: 151.2, timestamp: future }));
    expect(await res.json()).toMatchObject({ received: 0, dropped: 1 });
    expect(m.db.cleanerLocationPing.createMany).not.toHaveBeenCalled();
  });

  it("files a driver's ping against the next stop of their own active route", async () => {
    m.role.mockResolvedValue({ user: { id: `driver-${Math.random()}`, role: "LAUNDRY" } });
    m.db.laundryRoute.findFirst.mockResolvedValue({
      id: "route",
      stops: [{ taskId: "own-task", kind: "PICKUP", order: 0, propertyId: "p1" }],
    });
    m.db.laundryTask.findUnique.mockResolvedValue({ jobId: "own-job" });
    m.db.property.findUnique.mockResolvedValue(null);
    const res = await laundryPing(post({ lat: -33.8, lng: 151.2 }));
    expect(res.status).toBe(200);
    expect(m.db.laundryTask.findUnique).toHaveBeenCalledWith({ where: { id: "own-task" }, select: { jobId: true } });
    expect(m.db.cleanerLocationPing.create.mock.calls[0][0].data.jobId).toBe("own-job");
    expect(m.db.laundryTask.findFirst).not.toHaveBeenCalled();
  });

  it("falls back only to tasks at properties the driver serves, and stores nothing when there are none", async () => {
    m.role.mockResolvedValue({ user: { id: `driver-${Math.random()}`, role: "LAUNDRY" } });
    m.db.laundryRoute.findFirst.mockResolvedValue(null);
    m.scope.mockResolvedValue({ propertyId: { in: ["served"] } });
    m.db.laundryTask.findFirst.mockResolvedValue(null);
    const res = await laundryPing(post({ lat: -33.8, lng: 151.2 }));
    expect(await res.json()).toMatchObject({ received: 0, reason: "NO_LAUNDRY_TASKS" });
    for (const call of m.db.laundryTask.findFirst.mock.calls) {
      expect(call[0].where).toMatchObject({ propertyId: { in: ["served"] } });
    }
    expect(m.db.cleanerLocationPing.create).not.toHaveBeenCalled();
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
