import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc } from "@/lib/templates/model";
import { defaultQuoteDoc, TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { lintTemplateDoc } from "@/lib/templates/lint";
import { toQuoteContractData } from "@/lib/templates/adapters/quote";

const brand = DEFAULT_BRAND_TOKENS;

function fakeQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: "q_1",
    quoteNumber: "Q-3007",
    serviceType: "AIRBNB_TURNOVER",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    validUntil: new Date("2026-07-15T00:00:00.000Z"),
    subtotal: 420,
    gstAmount: 42,
    totalAmount: 462,
    notes: "Includes linen change. [[META:{\"bedrooms\":2}]]",
    lineItems: [
      { label: "Turnover clean", qty: 1, unitPrice: 260, total: 260 },
      { label: "Linen & staging", qty: 1, unitPrice: 90, total: 90 },
    ],
    client: { name: "James Harrington", address: "12 Marine Parade", suburb: "Coogee" },
    lead: null,
    ...overrides,
  };
}

describe("quote adapter", () => {
  it("maps quote fields, humanizes service type, strips META marker", () => {
    const data = toQuoteContractData(fakeQuote(), "https://x/quote/q_1");
    expect(data.quote.number).toBe("Q-3007");
    expect(data.quote.serviceType).toBe("Airbnb Turnover");
    expect(data.quote.totalAmount).toBe(462);
    expect(data.quote.gstEnabled).toBe(true);
    expect(data.quote.notes).toBe("Includes linen change.");
    expect(data.quote.lines[0].unitAmount).toBe(260); // raw number
    expect(data.client.address).toBe("12 Marine Parade, Coogee");
    expect(data.actionUrl).toBe("https://x/quote/q_1");
  });

  it("falls back to lead when no client", () => {
    const data = toQuoteContractData(fakeQuote({ client: null, lead: { name: "Lead Person", address: "5 St" } }));
    expect(data.client.name).toBe("Lead Person");
  });

  it("renders the doc.quote pilot and passes lint", () => {
    const doc = { ...emptyDoc("doc.quote"), blocks: defaultQuoteDoc() };
    expect(lintTemplateDoc(doc, brand).ok).toBe(true);
    const data = toQuoteContractData(fakeQuote());
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).toContain("Q-3007");
    expect(html).toContain("Turnover clean");
    expect(html).toContain("$462"); // total via {{ | money}}
    expect(html).toContain("Proposal for James Harrington");
  });

  it("hides GST row when gstAmount is zero and the notes callout when empty", () => {
    const doc = { ...emptyDoc("doc.quote"), blocks: defaultQuoteDoc() };
    const data = toQuoteContractData(fakeQuote({ gstAmount: 0, totalAmount: 420, notes: "" }));
    expect(data.quote.gstEnabled).toBe(false);
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).not.toContain(">GST<");
    expect(html).not.toContain("What&#39;s included");
  });

  it("has a working sample fixture for the editor", () => {
    const doc = { ...emptyDoc("doc.quote"), blocks: defaultQuoteDoc() };
    const html = renderDocumentHtml(doc, TEMPLATE_KINDS["doc.quote"].sampleData(), brand, "web", {});
    expect(html).toContain("$462");
  });
});
