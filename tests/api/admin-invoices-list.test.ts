import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  legacy: vi.fn(),
  context: vi.fn(),
  queryRaw: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { clientInvoice: { findMany: m.findMany, count: m.count, groupBy: m.groupBy }, $queryRaw: m.queryRaw } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", invoicing: { defaultPaymentTermsDays: 14 } }) }));
vi.mock("@/lib/billing/client-invoices", () => ({ listInvoiceContext: m.legacy, listInvoiceFormContext: m.context }));
vi.mock("@/lib/billing/client-invoice-stats", () => ({ getClientInvoiceStats: vi.fn() }));

import { GET } from "@/app/api/admin/invoices/route";

const get = (query: string) => GET(new NextRequest(`http://localhost/api/admin/invoices${query}`));

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv1",
    invoiceNumber: "INV-0001",
    status: "SENT",
    totalAmount: 200,
    paidAmount: 50,
    periodStart: new Date("2026-10-01T00:00:00Z"),
    periodEnd: new Date("2026-10-15T23:59:59.999Z"),
    sentAt: new Date("2026-10-16T00:00:00Z"),
    paidAt: null,
    paidDate: null,
    paymentMethod: null,
    paymentReference: null,
    createdAt: new Date("2026-10-16T00:00:00Z"),
    xeroInvoiceId: null,
    xeroExportedAt: null,
    metadata: null,
    kind: "INVOICE",
    clientReference: null,
    creditsInvoice: null,
    creditNotes: [],
    paymentTermsDays: null,
    client: { id: "c1", name: "Client One", email: "one@example.test", paymentTermsDays: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.findMany.mockImplementation(async (args: { select?: { id?: boolean; invoiceNumber?: boolean } }) =>
    // The first findMany reads pending Xero reservations (select id only).
    args.select?.invoiceNumber ? [invoice(), invoice({ id: "inv2", invoiceNumber: "INV-0002", status: "DRAFT", paidAmount: null, metadata: { xeroExportState: "PENDING" } })] : [{ id: "inv2" }],
  );
  m.count.mockResolvedValue(42);
  // Overdue ids are resolved in SQL with per-invoice terms (snapshot, client, default).
  m.queryRaw.mockResolvedValue([{ id: "inv1" }]);
  m.groupBy.mockResolvedValue([
    { status: "DRAFT", _count: { _all: 4 } },
    { status: "SENT", _count: { _all: 30 } },
    { status: "VOID", _count: { _all: 8 } },
  ]);
});

describe("GET /api/admin/invoices?paginated=1", () => {
  it("pages, sorts and returns real totals and grouped chip counts", async () => {
    const response = await get("?paginated=1&page=2&pageSize=10&sort=total&dir=asc&status=SENT");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ total: 42, page: 2, pageSize: 10, pageCount: 5, sort: "total", dir: "asc", paymentTermsDays: 14 });
    expect(body.counts).toMatchObject({ all: 42, active: 34, byStatus: { DRAFT: 4, SENT: 30, VOID: 8, PAID: 0 } });
    const rowsCall = m.findMany.mock.calls.find(([args]) => args.select?.invoiceNumber)![0];
    expect(rowsCall).toMatchObject({ skip: 10, take: 10, orderBy: [{ totalAmount: "asc" }, { id: "asc" }] });
    expect(JSON.stringify(rowsCall.where)).toContain('"status":"SENT"');
    expect(body.rows[0]).toMatchObject({ invoiceNumber: "INV-0001", amountOwing: 150, xeroState: "NONE", dueDate: "2026-10-30" });
    expect(body.rows[1]).toMatchObject({ xeroState: "PENDING", amountOwing: 200 });
  });

  it("marks sent invoices past their printed due day as overdue", async () => {
    const body = await (await get("?paginated=1")).json();
    expect(body.rows[0].overdue).toBe(true);
    expect(body.rows[1].overdue).toBe(false);
    expect(body.rows[0].paymentTermsDays).toBe(14);
  });

  it("uses the invoice's snapshot terms, else the client's, for the due day", async () => {
    m.findMany.mockImplementation(async (args: { select?: { invoiceNumber?: boolean } }) =>
      args.select?.invoiceNumber
        ? [invoice({ paymentTermsDays: 7, client: { id: "c1", name: "C", email: null, paymentTermsDays: 30 } }), invoice({ id: "inv3", status: "DRAFT", client: { id: "c1", name: "C", email: null, paymentTermsDays: 30 } })]
        : [],
    );
    const body = await (await get("?paginated=1")).json();
    expect(body.rows[0]).toMatchObject({ paymentTermsDays: 7, dueDate: "2026-10-23" });
    expect(body.rows[1]).toMatchObject({ paymentTermsDays: 30, dueDate: "2026-11-15" });
  });

  it("filters overdue by the per-invoice overdue ids", async () => {
    await get("?paginated=1&status=overdue");
    const rowsCall = m.findMany.mock.calls.find(([args]) => args.select?.invoiceNumber)![0];
    expect(JSON.stringify(rowsCall.where)).toContain('"id":{"in":["inv1"]}');
  });

  it("filters needs-action to drafts, approved and pending Xero exports", async () => {
    await get("?paginated=1&status=needs-action");
    const rowsCall = m.findMany.mock.calls.find(([args]) => args.select?.invoiceNumber)![0];
    const where = JSON.stringify(rowsCall.where);
    expect(where).toContain('"in":["DRAFT","APPROVED"]');
    expect(where).toContain('"id":{"in":["inv2"]}');
  });

  it.each(["sort=password", "page=0", "pageSize=500", "status=SECRET", "xero=maybe", "from=2026-13-01", "to=2026-02-30", "from=2026-11-02&to=2026-11-01"])(
    "refuses %s with 400 instead of ignoring it",
    async (query) => {
      const response = await get(`?paginated=1&${query}`);
      expect(response.status).toBe(400);
      expect(m.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ skip: expect.anything() }));
    },
  );

  it("keeps the live role guard: ADMIN and OPS_MANAGER only, refusals answered 401/403", async () => {
    await get("?paginated=1");
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await get("?paginated=1")).status).toBe(403);
    m.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await get("?paginated=1")).status).toBe(401);
    // Only the first, allowed request read data (total, needs-action and overdue counts).
    expect(m.count).toHaveBeenCalledTimes(3);
  });

  it("returns the original shape to callers that do not ask for paging", async () => {
    m.legacy.mockResolvedValue({ clients: [], properties: [], rates: [], invoices: [] });
    const body = await (await get("")).json();
    expect(body).toEqual({ clients: [], properties: [], rates: [], invoices: [] });
    m.context.mockResolvedValue({ clients: [], properties: [] });
    expect(await (await get("?view=context")).json()).toEqual({ clients: [], properties: [] });
  });
});
