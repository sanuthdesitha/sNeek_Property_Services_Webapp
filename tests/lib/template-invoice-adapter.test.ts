import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc } from "@/lib/templates/model";
import { defaultClientInvoiceDoc } from "@/lib/templates/kinds";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { toInvoiceContractData } from "@/lib/templates/adapters/client-invoice";

const brand = DEFAULT_BRAND_TOKENS;

// A representative ClientInvoice shape (the fields the adapter reads).
function fakeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    invoiceNumber: "INV-2001",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    periodEnd: new Date("2026-06-30T00:00:00.000Z"),
    subtotal: 500,
    gstAmount: 50,
    totalAmount: 550,
    client: { name: "Coastal Stays", email: "ops@coastal.example" },
    lines: [
      {
        description: "Airbnb turnover",
        quantity: 2,
        unitPrice: 120,
        lineTotal: 240,
        note: null,
        job: { id: "j1", jobNumber: "J-100", scheduledDate: new Date("2026-06-10"), property: { name: "12 Marine Pde", suburb: "Coogee" } },
      },
      {
        description: "Deep clean",
        quantity: 1,
        unitPrice: 260,
        lineTotal: 260,
        note: null,
        job: { id: "j2", jobNumber: "J-101", scheduledDate: new Date("2026-06-20"), property: { name: "88 Ocean View Rd", suburb: "Bronte" } },
      },
    ],
    ...overrides,
  } as never;
}

describe("client-invoice adapter", () => {
  it("maps invoice fields into the contract with raw numbers", () => {
    const data = toInvoiceContractData(fakeInvoice(), {
      bankName: "CBA",
      bankAccountNumber: "1234",
      defaultPaymentTermsDays: 14,
    });
    expect(data.invoice.number).toBe("INV-2001");
    expect(data.invoice.totalAmount).toBe(550);
    expect(data.invoice.gstEnabled).toBe(true);
    expect(data.invoice.lines).toHaveLength(2);
    expect(data.invoice.lines[0].unitAmount).toBe(120); // raw number, not formatted
    expect(data.payment.bankName).toBe("CBA");
    // due = issued + 14 days
    expect(data.invoice.dueAt.toISOString().slice(0, 10)).toBe("2026-07-15");
  });

  it("renders the doc.clientInvoice pilot from adapted data", () => {
    const doc = { ...emptyDoc("doc.clientInvoice"), blocks: defaultClientInvoiceDoc() };
    const data = toInvoiceContractData(fakeInvoice(), { bankName: "CBA", bankAccountNumber: "1234" });
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).toContain("INV-2001");
    expect(html).toContain("Airbnb turnover");
    expect(html).toContain("$550"); // total via {{ | money}}
    expect(html).toContain("$50"); // GST row present
  });

  it("hides GST row when gstAmount is zero", () => {
    const doc = { ...emptyDoc("doc.clientInvoice"), blocks: defaultClientInvoiceDoc() };
    const data = toInvoiceContractData(fakeInvoice({ gstAmount: 0, totalAmount: 500 }), {});
    expect(data.invoice.gstEnabled).toBe(false);
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).not.toContain(">GST<");
  });
});
