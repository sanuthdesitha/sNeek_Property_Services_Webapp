// @vitest-environment node
/**
 * Stripe checkout from the client portal returns to the NEW client finance
 * page (owner decision 2026-11-13): `?paid=1` after checkout, `?payment=cancelled`
 * when the client leaves it. No real payment: the Stripe call is mocked.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), portal: vi.fn(), user: vi.fn(), invoice: vi.fn(), credited: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: m.portal }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, clientInvoice: { findFirst: m.invoice } } }));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: m.settings }));
vi.mock("@/lib/finance/receivables", () => ({ invoiceAmountOwing: () => 110, readCreditedAmount: m.credited }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.example${path}` }));

import { POST } from "@/app/api/client/invoices/[id]/payment-link/route";

let stripeBody = "";
beforeEach(() => {
  vi.resetAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  m.role.mockResolvedValue({ user: { id: "client-user", role: "CLIENT" } });
  m.portal.mockResolvedValue({ visibility: { showFinanceDetails: true } });
  m.user.mockResolvedValue({ clientId: "c1" });
  m.invoice.mockResolvedValue({ id: "inv1", invoiceNumber: "INV-0041", status: "SENT", totalAmount: 110, paidAmount: 0, kind: "INVOICE" });
  m.credited.mockResolvedValue(0);
  m.settings.mockResolvedValue({ stripe: { enabled: true, successUrl: "", cancelUrl: "", currency: "aud", statementDescriptor: "" } });
  stripeBody = "";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    stripeBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ url: "https://checkout.stripe.test/session" }));
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STRIPE_SECRET_KEY;
});

describe("POST /api/client/invoices/[id]/payment-link", () => {
  it("returns the client to the new finance page with the paid and cancelled states", async () => {
    const response = await POST(new NextRequest("http://localhost/api/client/invoices/inv1/payment-link", { method: "POST" }), { params: { id: "inv1" } });
    expect(response.status).toBe(200);
    const form = new URLSearchParams(stripeBody);
    expect(form.get("success_url")).toBe("https://app.example/v2/client/finance?paid=1");
    expect(form.get("cancel_url")).toBe("https://app.example/v2/client/finance?payment=cancelled");
  });

  it("keeps a return address configured in Integrations", async () => {
    m.settings.mockResolvedValue({ stripe: { enabled: true, successUrl: "https://shop.example/thanks", cancelUrl: "", currency: "aud", statementDescriptor: "" } });
    await POST(new NextRequest("http://localhost/x", { method: "POST" }), { params: { id: "inv1" } });
    expect(new URLSearchParams(stripeBody).get("success_url")).toBe("https://shop.example/thanks");
  });
});
