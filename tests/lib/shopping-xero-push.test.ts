// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ invoice: vi.fn(), push: vi.fn(), update: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ id: "admin", role: "ADMIN" }) }));
vi.mock("@/lib/db", () => ({ db: { clientInvoice: { findUnique: m.invoice, update: m.update }, client: { update: vi.fn() } } }));
vi.mock("@/lib/xero/client", () => ({ pushClientInvoiceToXero: m.push }));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: m.settings }));
import { POST } from "@/app/api/admin/invoices/[id]/xero-push/route";
let invoice: any;
beforeEach(() => {
 vi.resetAllMocks();
 invoice = { id: "invoice", status: "DRAFT", invoiceNumber: "INV", gstEnabled: false, createdAt: new Date("2026-09-22"), clientId: "client", client: { name: "Client", email: "client@example.com", xeroContactId: "contact" }, lines: [{ description: "Purchase", quantity: 1, unitPrice: 100, category: "SHOPPING_DISBURSEMENT" }, { description: "Time", quantity: .5, unitPrice: 60, category: "SHOPPING_TIME" }] };
 m.invoice.mockImplementation(async () => invoice);
 m.settings.mockResolvedValue({ xero: { defaultAccountCode: "200", disbursementAccountCode: "800", salesTaxType: "OUTPUT", defaultItemCode: "SERVICE" } });
 m.push.mockResolvedValue({ xeroInvoiceId: "xero", contactId: "contact" }); m.update.mockResolvedValue({});
});
const request = () => POST(new NextRequest("http://localhost/api/admin/invoices/invoice/xero-push", { method: "POST", body: "{}" }), { params: { id: "invoice" } });
it("keeps GST disabled on ordinary lines while agency remains BAS excluded without a sales item", async () => {
 expect((await request()).status).toBe(200);
 expect(m.push).toHaveBeenCalledWith(expect.objectContaining({ gstEnabled: false, lineItems: [expect.objectContaining({ accountCode: "800", taxType: "BASEXCLUDED", itemCode: undefined }), expect.objectContaining({ accountCode: "200", taxType: "NONE", itemCode: "SERVICE" })] }));
});
it("preserves configured sales tax for taxable invoices", async () => { invoice.gstEnabled = true; expect((await request()).status).toBe(200); expect(m.push.mock.calls[0][0].lineItems[1].taxType).toBe("OUTPUT"); });
it("rejects missing separate agency mapping before any provider request", async () => { m.settings.mockResolvedValue({ xero: { defaultAccountCode: "", disbursementAccountCode: "200" } }); expect((await request()).status).toBe(400); expect(m.push).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); });
it("exports the reviewed shopping-time amount without fractional-hour rounding", async () => {
 invoice.lines = [{ category: "SHOPPING_TIME", description: "Shopping time (1 min @ $100.00/hour)", quantity: 1, unitPrice: 1.67, lineTotal: 1.67 }];
 expect((await request()).status).toBe(200);
 expect(m.push.mock.calls[0][0].lineItems[0]).toMatchObject({ quantity: 1, unitAmount: 1.67 });
});
