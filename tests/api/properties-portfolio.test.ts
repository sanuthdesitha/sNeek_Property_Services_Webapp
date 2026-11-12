// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ops: vi.fn(),
  db: {
    property: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    icalSyncRun: { findMany: vi.fn() },
    job: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    qAReview: { findMany: vi.fn() },
    laundryTask: { findMany: vi.fn() },
    jobTask: { findMany: vi.fn() },
    client: { findUniqueOrThrow: vi.fn() },
    clientInvoice: { findMany: vi.fn() },
    reservation: { findMany: vi.fn() },
    propertyNfcTag: { findMany: vi.fn() },
    propertyStock: { findMany: vi.fn() },
    propertyClientRate: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", laundryOperations: { maxOutdoorDays: 3 }, laundryPortalVisibility: {} }) }));
vi.mock("@/lib/property-form/config-store", () => ({ getPropertyFormConfig: async () => ({ version: 1, systemFields: {}, customFields: [] }) }));

import { GET as listGet } from "@/app/api/admin/properties/route";
import { GET as overviewGet } from "@/app/api/admin/properties/[id]/overview/route";

type Prop = { id: string; name: string; client: string; serviceSite?: boolean; keyLost?: boolean; team?: string[]; status?: string };
function property(p: Prop) {
  return {
    id: p.id, name: p.name, suburb: "Glebe", address: `${p.id} St`, bedrooms: 2, bathrooms: 1, imageUrl: null,
    accessInfo: { ...(p.serviceSite ? { serviceSite: true } : {}), laundryTeamUserIds: p.team ?? ["clxlaundry000000000000000"] },
    keyLostMode: p.keyLost ?? false, laundryEnabled: true, latitude: null, longitude: null,
    client: { id: `c-${p.client}`, name: p.client },
    integration: p.status ? { isEnabled: true, icalUrl: "https://example.invalid/x.ics", syncStatus: p.status, syncError: p.status === "ERROR" ? "Feed 404" : null, lastSyncAt: null } : null,
    _count: { jobs: 4 },
  };
}

const PROPERTIES = [
  property({ id: "a", name: "Bronte Flat", client: "Private", status: "SUCCESS" }),
  property({ id: "b", name: "Coogee Terrace", client: "Harbour", keyLost: true, status: "SUCCESS" }),
  property({ id: "c", name: "Glebe House", client: "Northside", status: "ERROR" }),
  property({ id: "d", name: "Paddington Row", client: "Northside", team: [] }),
  property({ id: "e", name: "One-off site", client: "Walk-ins", serviceSite: true }),
];

const get = (query: string) => listGet(new NextRequest(`http://localhost/api/admin/properties?${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "office", role: "ADMIN" } });
  m.ops.mockResolvedValue(null);
  m.db.property.findMany.mockImplementation(async (args: { where?: { id?: { in: string[] } } }) => {
    const ids = args?.where?.id?.in;
    return ids ? PROPERTIES.filter((row) => ids.includes(row.id)) : PROPERTIES;
  });
  m.db.icalSyncRun.findMany.mockResolvedValue([{ propertyId: "c", createdAt: new Date(Date.now() - 6 * 3_600_000) }]);
  m.db.job.findMany.mockResolvedValue([]);
  m.db.job.count.mockResolvedValue(0);
  m.db.qAReview.findMany.mockResolvedValue([]);
  m.db.laundryTask.findMany.mockResolvedValue([]);
  m.db.jobTask.findMany.mockResolvedValue([]);
});

describe("GET /api/admin/properties?shape=list", () => {
  it("answers real totals, chip counts and stats over the whole filter set, one page at a time", async () => {
    const response = await get("shape=list&pageSize=2&page=1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(4); // one-off site hidden by default
    expect(body.rows.map((row: { name: string }) => row.name)).toEqual(["Bronte Flat", "Coogee Terrace"]);
    expect(body.counts).toMatchObject({ attention: 3, "sync-error": 1, "key-lost": 1, "no-laundry-partner": 1, oneOff: 1 });
    expect(body.stats).toMatchObject({ active: 4, clients: 3, calendarLinked: 3, syncErrors: 1, jobsAllTime: 16, needsAttention: 3 });
    expect(body.rows[0].qa).toEqual({ score: null, reviewed: 0 });
  });

  it("filters by chip and shows one-off sites only when asked", async () => {
    const sync = await (await get("shape=list&chip=sync-error")).json();
    expect(sync.rows.map((row: { id: string }) => row.id)).toEqual(["c"]);
    expect(sync.rows[0].calendar).toMatchObject({ kind: "failed", error: "Feed 404" });
    const all = await (await get("shape=list&includeOneOff=1")).json();
    expect(all.total).toBe(5);
  });

  it("refuses an unknown sort column or chip with 400", async () => {
    expect((await get("shape=list&sort=price")).status).toBe(400);
    expect((await get("shape=list&chip=everything")).status).toBe(400);
  });

  it("keeps the session guard (401) and the original array shape without shape=list", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await get("shape=list")).status).toBe(401);
    m.db.property.findMany.mockResolvedValueOnce(PROPERTIES);
    const legacy = await (await get("")).json();
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toHaveLength(4);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });
});

describe("GET /api/admin/properties/:id/overview", () => {
  beforeEach(() => {
    m.db.property.findUnique.mockResolvedValue({
      id: "a", clientId: "c1", accessInfo: {}, customFields: null, laundryEnabled: true, laundryBagLabel: null, laundryBagColor: null,
      defaultCheckinTime: "15:00", defaultCheckoutTime: "10:00", requireNfcCheckIn: false, integration: null,
    });
    m.db.client.findUniqueOrThrow.mockResolvedValue({ id: "c1", name: "Harbour", phone: null, email: null, paymentTermsDays: 14 });
    m.db.property.count.mockResolvedValue(6);
    m.db.clientInvoice.findMany.mockResolvedValue([{ totalAmount: 500, paidAmount: 100, creditNotes: [] }]);
    m.db.reservation.findMany.mockResolvedValue([]);
    m.db.job.findFirst.mockResolvedValue(null);
    m.db.propertyNfcTag.findMany.mockResolvedValue([]);
    m.db.propertyStock.findMany.mockResolvedValue([]);
    m.db.propertyClientRate.findMany.mockResolvedValue([]);
    m.db.user.findMany.mockResolvedValue([]);
  });
  const overview = () => overviewGet(new NextRequest("http://localhost/api/admin/properties/a/overview"), { params: { id: "a" } });

  it("includes what the client owes for an admin", async () => {
    const body = await (await overview()).json();
    expect(body.client).toMatchObject({ owingAud: 400, owingShown: true, propertyCount: 6 });
    expect(body.lastClean).toBeNull();
  });

  it("leaves money out on the server for an operations manager without finance", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
    m.ops.mockResolvedValue({ finance: "off" });
    const body = await (await overview()).json();
    expect(body.client).toMatchObject({ owingAud: null, owingShown: false });
    expect(m.db.clientInvoice.findMany).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown property", async () => {
    m.db.property.findUnique.mockResolvedValueOnce(null);
    expect((await overview()).status).toBe(404);
  });
});
