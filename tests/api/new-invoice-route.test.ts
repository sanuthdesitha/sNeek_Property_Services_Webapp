// @vitest-environment node
/**
 * New invoice routes (GET/POST /api/admin/invoices/generate):
 * - the live role guard (ADMIN, OPS_MANAGER, as before) runs on the preview,
 *   the period default and the create; a refused guard reads or writes nothing;
 * - a request key goes to the idempotent request service, without one the
 *   old generator call is unchanged;
 * - the period default rule itself (pure).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), generate: vi.fn(), run: vi.fn(), preview: vi.fn(), period: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/billing/client-invoices", () => ({ generateClientInvoice: m.generate }));
vi.mock("@/lib/billing/client-invoice-generate-preview", () => ({ previewClientInvoiceGeneration: m.preview }));
vi.mock("@/lib/billing/client-invoice-generate-request", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/client-invoice-generate-request")>("@/lib/billing/client-invoice-generate-request");
  return { ...actual, runGenerateRequest: m.run };
});
vi.mock("@/lib/billing/invoice-period-default", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/invoice-period-default")>("@/lib/billing/invoice-period-default");
  return { ...actual, defaultInvoicePeriod: m.period };
});

import { GET, POST } from "@/app/api/admin/invoices/generate/route";
import { nextDayKey, periodDefaultFrom } from "@/lib/billing/invoice-period-default";

const get = (query: string) => GET(new NextRequest(`http://local/api/admin/invoices/generate?${query}`));
const post = (body: unknown) => POST(new NextRequest("http://local/api/admin/invoices/generate", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.preview.mockResolvedValue({ client: { id: "c1", name: "Client" }, jobs: [] });
  m.run.mockResolvedValue({ status: 200, body: { id: "inv", invoiceNumber: "INV-1", totalAmount: 10, lineCount: 1, notBilled: [], replayed: false } });
  m.generate.mockResolvedValue({ id: "inv" });
  m.period.mockResolvedValue({ start: "2026-11-01", end: "2026-11-14", source: "MONTH_START", lastInvoiceNumber: null, lastPeriodEnd: null });
});

describe("authorization", () => {
  it("asks the live guard for ADMIN or OPS_MANAGER on every view and on create", async () => {
    await get("view=preview&clientId=c1&from=2026-11-01&to=2026-11-14");
    await get("view=period&clientId=c1");
    await post({ requestKey: "generate:abcdefgh", clientId: "c1" });
    expect(m.role).toHaveBeenCalledTimes(3);
    for (const call of m.role.mock.calls) expect(call[0]).toEqual(["ADMIN", "OPS_MANAGER"]);
  });

  it("refuses with 403 and reads or writes nothing when the guard refuses", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await get("view=preview&clientId=c1")).status).toBe(403);
    expect((await get("view=period&clientId=c1")).status).toBe(403);
    expect((await post({ requestKey: "generate:abcdefgh", clientId: "c1" })).status).toBe(403);
    expect((await post({ clientId: "c1" })).status).toBe(403);
    expect(m.preview).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    m.role.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await post({ clientId: "c1" })).status).toBe(401);
  });
});

describe("requests", () => {
  it("previews the selection as Sydney calendar days without creating anything", async () => {
    const response = await get("view=preview&clientId=c1&propertyId=p1&from=2026-11-01&to=2026-11-14&basis=SERVICE&gst=0");
    expect(response.status).toBe(200);
    expect(m.preview).toHaveBeenCalledWith({
      clientId: "c1", propertyId: "p1", periodStart: new Date("2026-10-31T13:00:00.000Z"), periodEnd: new Date("2026-11-14T12:59:59.999Z"), gstEnabled: false, periodBasis: "SERVICE",
    });
    expect(m.run).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("refuses a period whose start is after its end", async () => {
    expect((await get("view=preview&clientId=c1&from=2026-11-14&to=2026-11-01")).status).toBe(400);
    expect(m.preview).not.toHaveBeenCalled();
  });

  it("sends a keyed create to the idempotent request service with the named unrated jobs", async () => {
    const response = await post({ requestKey: "generate:abcdefgh", clientId: "c1", periodStart: "2026-11-01", periodEnd: "2026-11-14", periodBasis: "SCHEDULED", gstEnabled: true, leaveOutUnratedJobIds: ["j1077"] });
    expect(response.status).toBe(200);
    expect(m.run).toHaveBeenCalledWith({ actorId: "admin", request: expect.objectContaining({ requestKey: "generate:abcdefgh", leaveOutUnratedJobIds: ["j1077"] }) });
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("keeps the old unkeyed generator call exactly as it was", async () => {
    await post({ clientId: "c1", periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-15T23:59:59.999Z", gstEnabled: true, periodBasis: "SCHEDULED" });
    expect(m.generate).toHaveBeenCalledWith({
      clientId: "c1", propertyId: null, periodStart: new Date("2026-08-31T14:00:00.000Z"), periodEnd: new Date("2026-09-15T13:59:59.999Z"), gstEnabled: true, periodBasis: "SCHEDULED",
    });
    expect(m.run).not.toHaveBeenCalled();
  });

  it("refuses an unknown field on a keyed create", async () => {
    expect((await post({ requestKey: "generate:abcdefgh", clientId: "c1", status: "SENT" })).status).toBe(400);
    expect(m.run).not.toHaveBeenCalled();
  });
});

describe("period default", () => {
  it("starts the day after the last invoice ended and runs to today", () => {
    expect(periodDefaultFrom({ todayKey: "2026-11-14", lastEndKey: "2026-10-31", lastInvoiceNumber: "INV-0418" })).toEqual({ start: "2026-11-01", end: "2026-11-14", source: "LAST_INVOICE", lastInvoiceNumber: "INV-0418", lastPeriodEnd: "2026-10-31" });
    expect(periodDefaultFrom({ todayKey: "2026-11-14", lastEndKey: "2026-11-07", lastInvoiceNumber: "INV-9" }).start).toBe("2026-11-08");
  });

  it("falls back to the 1st of the month with no earlier invoice, or one ending today or later", () => {
    expect(periodDefaultFrom({ todayKey: "2026-11-14", lastEndKey: null, lastInvoiceNumber: null })).toMatchObject({ start: "2026-11-01", end: "2026-11-14", source: "MONTH_START" });
    expect(periodDefaultFrom({ todayKey: "2026-11-14", lastEndKey: "2026-11-14", lastInvoiceNumber: "INV-1" }).source).toBe("MONTH_START");
  });

  it("crosses month and year ends on the calendar date alone", () => {
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01");
    expect(nextDayKey("2028-02-28")).toBe("2028-02-29");
  });
});
