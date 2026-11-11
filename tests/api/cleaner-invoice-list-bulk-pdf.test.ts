// @vitest-environment node
/**
 * Money step (e) routes: the paged cleaner-invoice list (and the unchanged old
 * response), the stats, the bulk route's per-row outcomes and ADMIN-only
 * approve, the admin PDF guard and snapshot, and the payroll mapping of the
 * review page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn(),
  users: vi.fn(), userOne: vi.fn(), audit: vi.fn(), apply: vi.fn(), push: vi.fn(), render: vi.fn(), settings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://files/${key}` }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/cleaner/invoice", () => ({ renderCleanerInvoicePdf: m.render }));
vi.mock("@/lib/db", () => ({
  db: {
    cleanerInvoiceSubmission: { findMany: m.findMany, findUnique: m.findUnique, count: m.count, groupBy: m.groupBy, aggregate: m.aggregate },
    user: { findMany: m.users, findUnique: m.userOne },
    auditLog: { create: m.audit },
  },
}));
vi.mock("@/lib/cleaner/invoice-admin-actions", async (original) => ({
  ...(await original<typeof import("@/lib/cleaner/invoice-admin-actions")>()),
  applyCleanerInvoiceStatus: m.apply,
  pushCleanerInvoiceOnce: m.push,
}));

import { GET as list } from "@/app/api/admin/cleaner-invoices/route";
import { POST as bulk } from "@/app/api/admin/cleaner-invoices/bulk/route";
import { GET as pdf } from "@/app/api/admin/cleaner-invoices/[id]/pdf/route";
import { opsRequestFeature } from "@/lib/rbac/ops-catalog";

const row = (id: string, status = "SUBMITTED", extra: Record<string, unknown> = {}) => ({
  id, invoiceNumber: `CL-${id}`, cleanerId: "c1", periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-15T00:00:00Z"),
  hours: 2, totalAmount: 50, jobCount: 1, lineData: { lines: [{ description: "Clean · Bondi", quantity: 1, unitAmount: 50 }] }, status,
  xeroBillId: null, xeroExportedAt: null, createdAt: new Date("2026-10-16T00:00:00Z"), paidAmount: null, paidBankAccount: null, paidNote: null,
  paymentMethod: null, paidDate: null, paidAt: null, paidClaimedAt: null, paidClaimedNote: null, paidClaimedProofKeys: ["proof/a.jpg"],
  changesRequestedAt: null, changesRequestedNote: null, updatedAt: new Date(), ...extra,
});
const get = (query = "") => list(new NextRequest(`http://local/api/admin/cleaner-invoices${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.findMany.mockResolvedValue([row("a"), row("b", "APPROVED")]);
  m.count.mockResolvedValue(2);
  m.groupBy.mockResolvedValue([{ status: "SUBMITTED", _count: { _all: 3 } }, { status: "APPROVED", _count: { _all: 2 } }, { status: "PAID", _count: { _all: 7 } }]);
  m.users.mockResolvedValue([{ id: "c1", name: "Sam", email: "sam@x", role: "CLEANER" }]);
  m.audit.mockResolvedValue({});
});

describe("list", () => {
  it("keeps the old response for callers without paginated=1 (classic screen)", async () => {
    const body = await (await get()).json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: "a", cleanerName: "Sam", cleanerRole: "CLEANER", paidClaimedProofUrls: [{ key: "proof/a.jpg", url: "https://files/proof/a.jpg" }] });
    expect(m.findMany).toHaveBeenCalledWith({ orderBy: [{ createdAt: "desc" }], take: 200 });
  });

  it("pages, sorts and filters on the server with real chip counts", async () => {
    const response = await get("?paginated=1&status=needs-action&sort=total&dir=asc&page=2&pageSize=10&cleaner=c1&from=2026-10-01");
    const body = await response.json();
    expect(body).toMatchObject({ total: 2, page: 2, pageSize: 10, sort: "total", dir: "asc", counts: { all: 12, needsAction: 5, byStatus: { PAID: 7 } } });
    const args = m.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 10, take: 10, orderBy: [{ totalAmount: "asc" }, { id: "asc" }] });
    expect(JSON.stringify(args.where)).toContain('"cleanerId":"c1"');
    expect(JSON.stringify(args.where)).toContain("APPROVED");
  });

  it("searches invoice number or payee name", async () => {
    m.users.mockResolvedValueOnce([{ id: "c9" }]).mockResolvedValue([]);
    await get("?paginated=1&q=sam");
    expect(JSON.stringify(m.findMany.mock.calls[0][0].where)).toContain('"cleanerId":{"in":["c9"]}');
  });

  it.each(["?paginated=1&sort=cleanerName", "?paginated=1&status=SYNCED", "?paginated=1&from=2026-10-09&to=2026-10-01"])("refuses %s with 400", async (query) => {
    expect((await get(query)).status).toBe(400);
  });

  it("stats are stored totals; APPROVED counts as awaiting, never as paid", async () => {
    m.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(9);
    m.aggregate.mockResolvedValue({ _sum: { totalAmount: 120.5 } });
    expect(await (await get("?view=stats")).json()).toEqual({ awaitingAction: 4, awaitingValue: 120.5, inXero: 1, paid: 9 });
    expect(m.count.mock.calls[0][0].where.status.in).toContain("APPROVED");
    expect(m.aggregate.mock.calls[0][0].where.status.in).toEqual(["SUBMITTED", "APPROVED"]);
  });

  it("answers 401/403 from the guard", async () => {
    m.auth.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await get("?paginated=1")).status).toBe(403);
  });
});

describe("bulk", () => {
  const post = (body: unknown) => bulk(new NextRequest("http://local/api/admin/cleaner-invoices/bulk", { method: "POST", body: JSON.stringify(body) }));

  it("refuses approve for an operations manager with 403 and runs nothing", async () => {
    m.auth.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
    expect((await post({ action: "approve", ids: ["a"] })).status).toBe(403);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it("answers per row through the single-row action; refused rows are never done", async () => {
    m.findMany.mockResolvedValue([row("a"), row("b", "APPROVED"), row("c")]);
    m.apply.mockImplementation(async ({ id }: { id: string }) => (id === "a" ? { status: 200, body: { ok: true } } : { status: 409, body: { error: "Changed" } }));
    const body = await (await post({ action: "approve", ids: ["a", "b", "c", "missing"] })).json();
    expect(body.results.map((r: { id: string; outcome: string }) => [r.id, r.outcome])).toEqual([["a", "done"], ["b", "unchanged"], ["c", "refused"], ["missing", "refused"]]);
    expect(body.summary).toEqual({ done: 1, refused: 2, unchanged: 1 });
    expect(m.apply).toHaveBeenCalledWith({ id: "a", body: { status: "APPROVED" }, actor: { id: "admin", role: "ADMIN" } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLEANER_INVOICE_BULK_ACTION" }) });
  });

  it("lets an operations manager bulk push; already-exported rows are unchanged", async () => {
    m.auth.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
    m.findMany.mockResolvedValue([row("a", "APPROVED"), row("b", "XERO_PUSHED", { xeroBillId: "x" })]);
    m.push.mockResolvedValue({ status: 200, body: { ok: true } });
    const body = await (await post({ action: "xero-push", ids: ["a", "b"] })).json();
    expect(body.results.map((r: { outcome: string }) => r.outcome)).toEqual(["done", "unchanged"]);
    expect(m.push).toHaveBeenCalledTimes(1);
  });

  it("validates the request; record payment is not a bulk action", async () => {
    expect((await post({ action: "record-payment", ids: ["a"] })).status).toBe(400);
    expect((await post({ action: "approve", ids: [] })).status).toBe(400);
  });
});

describe("admin PDF", () => {
  const getPdf = (id = "a") => pdf(new NextRequest(`http://local/api/admin/cleaner-invoices/${id}/pdf`), { params: { id } });

  it("is behind the admin guard", async () => {
    m.auth.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await getPdf()).status).toBe(401);
    m.auth.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await getPdf()).status).toBe(403);
    expect(m.render).not.toHaveBeenCalled();
  });

  it("renders this submission's snapshot only, with the cleaner download renderer", async () => {
    m.findUnique.mockResolvedValue(row("a"));
    m.userOne.mockResolvedValue({ name: "Sam", email: "sam@x" });
    m.settings.mockResolvedValue({ companyName: "sNeek" });
    m.render.mockResolvedValue(Buffer.from("%PDF"));
    const response = await getPdf();
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const html = m.render.mock.calls[0][0] as string;
    expect(html).toContain("CL-a");
    expect(html).toContain("Clean · Bondi");
    expect(html).toContain("$50.00");
    expect(m.findUnique).toHaveBeenCalledWith({ where: { id: "a" } });
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown invoice", async () => {
    m.findUnique.mockResolvedValue(null);
    expect((await getPdf("nope")).status).toBe(404);
  });
});

it("maps the review page and the cleaner-invoice APIs to the payroll pack", () => {
  expect(opsRequestFeature("/v2/admin/finance/cleaner-invoices/abc")).toBe("payroll");
  expect(opsRequestFeature("/api/admin/cleaner-invoices/abc/pdf")).toBe("payroll");
  expect(opsRequestFeature("/api/admin/cleaner-invoices/bulk")).toBe("payroll");
  expect(opsRequestFeature("/api/admin/invoices/xero-sync")).toBe("finance");
  expect(opsRequestFeature("/v2/admin/finance/invoices/abc")).toBe("finance");
});
