/**
 * The quote reference clients can see ("Q-204", owner decision 2026-11-13) on
 * the client's Approvals card and the quote document (PDF and email body).
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://files.invalid/${key}` }));

import { QuoteDecisionCard } from "@/components/v2/client/approvals/quote-decision-card";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";

const waiting = { id: "q1", reference: "Q-204", serviceType: "DEEP_CLEAN", totalAmount: 330, validUntil: null, createdAt: "2026-11-10T00:00:00Z", expired: false };

describe("quote reference", () => {
  it("is on the client's Approvals card, and absent rather than invented when unknown", () => {
    const view = render(<QuoteDecisionCard quote={waiting} />);
    expect(screen.getByText("Quote Q-204")).toBeInTheDocument();
    view.unmount();
    render(<QuoteDecisionCard quote={{ ...waiting, reference: null }} />);
    expect(screen.queryByText(/Q-/)).toBeNull();
    expect(screen.getByText("Quote")).toBeInTheDocument();
  });

  it("is the Quote # on the quote document", () => {
    const html = buildQuoteHtml({ id: "cmquoteabc", quoteNumber: 204, serviceType: "DEEP_CLEAN", lineItems: [], subtotal: 300, gstAmount: 30, totalAmount: 330, createdAt: new Date("2026-11-10T00:00:00Z") });
    expect(html).toContain("Quote Q-204");
    expect(html).not.toContain("0000204");
  });
});
