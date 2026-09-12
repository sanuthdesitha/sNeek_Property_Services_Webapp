import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FinancePage from "@/app/v2/client/finance/page";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), portal: vi.fn(), finance: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortalPage: mocks.auth }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: mocks.portal }));
vi.mock("@/lib/billing/client-portal-finance", () => ({ getClientFinanceOverview: mocks.finance }));
vi.mock("@/components/v2/client/pay-invoice-button", () => ({ PayInvoiceButton: () => <button>Pay invoice</button> }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "actor", userName: "Client", actor: "CLIENT", propertyIds: ["allowed"] });
  mocks.portal.mockResolvedValue({ clientId: "client", client: { name: "Client" }, visibility: { showFinanceDetails: true } });
  mocks.finance.mockResolvedValue({ summary: { activeRates: 0, pendingChargeCount: 0, pendingChargeTotal: 0, invoiceCount: 0, totalBilled: 0 }, rates: [], recentCharges: [], invoices: [] });
});
describe("client financial information", () => {
  it.each(["portal", "finance"] as const)("reports %s failure without fabricating hidden access or zero balance", async source => {
    mocks[source].mockRejectedValue(new Error("private internal error"));
    render(await FinancePage());
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/v2/client/finance");
    expect(screen.queryByText("Financial details are hidden")).toBeNull();
    expect(screen.queryByText("No invoices issued")).toBeNull();
  });
  it("keeps deliberately hidden financial data hidden", async () => {
    mocks.portal.mockResolvedValue({ visibility: { showFinanceDetails: false } });
    render(await FinancePage());
    expect(screen.getByText("Financial details are hidden")).toBeVisible();
    expect(mocks.finance).not.toHaveBeenCalled();
  });
  it("labels capped history and distinguishes estimates from amounts owed", async () => {
    render(await FinancePage());
    expect(screen.getByText(/latest 50 completed jobs/)).toHaveTextContent("not an invoice or a payment request");
    expect(screen.getByText("latest 20 invoices, including paid")).toBeVisible();
    expect(screen.queryByText("all time")).toBeNull();
    expect(mocks.finance).toHaveBeenCalledWith("client", ["allowed"]);
  });
  it.each(["CLIENT", "VA"])("keeps payment controls limited for %s", async actor => {
    mocks.auth.mockResolvedValue({ userId: "actor", actor, propertyIds: ["allowed"] });
    mocks.finance.mockResolvedValue({ summary: {}, rates: [], recentCharges: [], invoices: [
      { id: "invoice", invoiceNumber: "INV-1", status: "SENT", totalAmount: 100, createdAt: new Date("2026-09-01T00:00:00Z") },
      { id: "paid", invoiceNumber: "INV-2", status: "PAID", totalAmount: 100, createdAt: new Date("2026-09-01T00:00:00Z") },
      { id: "part", invoiceNumber: "INV-3", status: "PART_PAID", totalAmount: 100, createdAt: new Date("2026-09-01T00:00:00Z") },
    ] });
    render(await FinancePage());
    expect(screen.getByRole("link", { name: "INV-1" })).toHaveAttribute("href", "/v2/client/finance/invoices/invoice");
    expect(screen.getByText("Payment recorded")).toBeVisible();
    expect(screen.getByText("Part paid")).toBeVisible();
    expect(screen.queryAllByRole("button", { name: "Pay invoice" })).toHaveLength(actor === "CLIENT" ? 1 : 0);
  });
});
