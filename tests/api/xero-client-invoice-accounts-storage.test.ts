// @vitest-environment node
/**
 * Stored Xero accounts for client invoices (2026-11-23): nothing stored reads
 * as not chosen (never "200"); a stored "200" keeps working but unconfirmed;
 * saving from the Client invoices card confirms it; other saves do not; only
 * administrators may change the settings; both CSV exports refuse with no
 * sales account and use the chosen one.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  row: null as { value: unknown } | null,
  upsert: vi.fn(),
  audit: vi.fn(),
  quotes: vi.fn(),
  invoiceUpdate: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/database-runtime", () => ({ canUseNodePrisma: () => true }));
vi.mock("@/lib/db", () => ({
  db: {
    appSetting: {
      findUnique: vi.fn(async () => m.row),
      upsert: m.upsert,
    },
    auditLog: { create: m.audit },
    quote: { findMany: m.quotes },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));

import { getPhase3IntegrationsSettings, nextSalesAccountConfirmed, savePhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { PATCH } from "@/app/api/admin/integrations/settings/route";
import { GET as exportQuotes } from "@/app/api/admin/integrations/xero/export/route";
import { buildClientInvoiceXeroCsv } from "@/lib/billing/client-invoices";

beforeEach(() => {
  vi.clearAllMocks();
  m.row = null;
  m.upsert.mockImplementation(async ({ create }: { create: { value: unknown } }) => {
    m.row = { value: create.value };
    return m.row;
  });
  m.requireRole.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.quotes.mockResolvedValue([
    { id: "quote-1", createdAt: new Date("2026-11-01T00:00:00Z"), validUntil: null, serviceType: "DEEP_CLEAN", subtotal: 300, gstAmount: 30, client: { name: "Client", email: "c@example.com" }, lead: null },
  ]);
});

describe("stored sales account", () => {
  it("reads nothing stored as not chosen, never 200", async () => {
    expect((await getPhase3IntegrationsSettings()).xero.defaultAccountCode).toBe("");
    m.row = { value: { xero: { tenantId: "t" } } };
    expect((await getPhase3IntegrationsSettings()).xero.defaultAccountCode).toBe("");
    m.row = { value: { xero: { defaultAccountCode: "   " } } };
    expect((await getPhase3IntegrationsSettings()).xero.defaultAccountCode).toBe("");
  });

  it("keeps an already-stored 200 working, unconfirmed", async () => {
    m.row = { value: { xero: { defaultAccountCode: "200" } } };
    const xero = (await getPhase3IntegrationsSettings()).xero;
    expect(xero).toMatchObject({ defaultAccountCode: "200", defaultAccountCodeConfirmed: false });
  });

  it("a save from another card neither writes 200 nor confirms the stored one", async () => {
    await savePhase3IntegrationsSettings({ xero: { cleanerBillAccountCode: "477" } });
    expect((m.row!.value as { xero: Record<string, unknown> }).xero.defaultAccountCode).toBe("");
    m.row = { value: { xero: { defaultAccountCode: "200" } } };
    await savePhase3IntegrationsSettings({ xero: { defaultItemCode: "CLEAN", defaultAccountCode: "200" } });
    expect((m.row!.value as { xero: Record<string, unknown> }).xero).toMatchObject({ defaultAccountCode: "200", defaultAccountCodeConfirmed: false });
  });

  it("confirms on an explicit save or a deliberate change; an empty account is never confirmed", () => {
    const legacy = { defaultAccountCode: "200", defaultAccountCodeConfirmed: false };
    expect(nextSalesAccountConfirmed(legacy, { defaultAccountCode: "200", defaultAccountCodeConfirmed: true }, "200")).toBe(true);
    expect(nextSalesAccountConfirmed(legacy, { defaultAccountCode: "4000" }, "4000")).toBe(true);
    expect(nextSalesAccountConfirmed(legacy, { defaultAccountCode: "200" }, "200")).toBe(false);
    expect(nextSalesAccountConfirmed({ defaultAccountCode: "4000", defaultAccountCodeConfirmed: true }, { defaultItemCode: "X" }, "4000")).toBe(true);
    expect(nextSalesAccountConfirmed(legacy, { defaultAccountCode: "", defaultAccountCodeConfirmed: true }, "")).toBe(false);
  });
});

describe("settings route", () => {
  it("lets only administrators change the settings (live role guard)", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const refused = await PATCH(new NextRequest("http://localhost/api/admin/integrations/settings", { method: "PATCH", body: JSON.stringify({ xero: { defaultAccountCode: "4000" } }) }));
    expect(refused.status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("refuses an invalid account code with its rule and saves a valid one confirmed", async () => {
    const bad = await PATCH(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ xero: { clientShoppingAccountCode: "42 00" } }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("Xero account code");
    const ok = await PATCH(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ xero: { defaultAccountCode: "200", defaultAccountCodeConfirmed: true, clientShoppingAccountCode: "4200" } }) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).xero).toMatchObject({ defaultAccountCode: "200", defaultAccountCodeConfirmed: true, clientShoppingAccountCode: "4200" });
  });
});

describe("CSV exports", () => {
  const exportRequest = () => exportQuotes(new NextRequest("http://localhost/api/admin/integrations/xero/export?startDate=2026-11-01&endDate=2026-11-30"));

  it("refuses the quotes export with no sales account before reading quotes, and uses the chosen account", async () => {
    m.row = { value: { xero: { enabled: true } } };
    const refused = await exportRequest();
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("before exporting");
    expect(m.quotes).not.toHaveBeenCalled();
    m.row = { value: { xero: { enabled: true, defaultAccountCode: "4000" } } };
    const csv = await (await exportRequest()).text();
    expect(csv.split("\n")[1]).toContain(",4000,");
    expect(csv).not.toContain(",200,");
  });

  it("refuses an invoice's CSV with no sales account and maps a credit note to its own account", async () => {
    const invoice = {
      kind: "CREDIT_NOTE", client: { name: "Client", email: "c@example.com" }, invoiceNumber: "CN-1", createdAt: new Date("2026-11-01"), periodEnd: null, gstAmount: 0,
      lines: [{ id: "l1", description: "Clean", quantity: 1, unitPrice: -100, category: "SERVICE", job: null, property: null }],
    } as unknown as Parameters<typeof buildClientInvoiceXeroCsv>[0];
    await expect(buildClientInvoiceXeroCsv(invoice)).rejects.toThrow("before exporting");
    m.row = { value: { xero: { defaultAccountCode: "4000", clientCreditNoteAccountCode: "4900" } } };
    expect(await buildClientInvoiceXeroCsv(invoice)).toContain('"NONE","4900"');
  });
});
