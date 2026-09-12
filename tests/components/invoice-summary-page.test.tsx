import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoiceSummaryPage } from "@/components/v2/shared/invoice-summary-page";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(), notFound: vi.fn(), redirect: vi.fn(),
  notFoundError: new Error("NEXT_NOT_FOUND"),
  redirectError: new Error("NEXT_REDIRECT"),
}));
vi.mock("@/lib/billing/portal-invoice-summary", () => ({ getPortalInvoiceSummary: mocks.summary }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

function invoice() {
  return {
    id: "inv-1", invoiceNumber: "INV-2026-0042", status: "PARTIALLY_PAID",
    totalAmount: { toString: () => "1234.50" },
    periodStart: new Date("2026-08-31T14:30:00Z"),
    periodEnd: new Date("2026-09-07T14:30:00Z"),
    createdAt: new Date("2026-09-08T14:30:00Z"),
    sentAt: new Date("2026-09-09T14:30:00Z"),
  };
}

function expectDetail(label: string, value: string) {
  const term = screen.getByText(label, { selector: "dt" });
  expect(term.nextElementSibling?.textContent).toBe(value);
  expect(term.nextElementSibling).toBeVisible();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.summary.mockResolvedValue(invoice());
  // Next navigation terminates rendering by throwing.
  mocks.notFound.mockImplementation(() => { throw mocks.notFoundError; });
  mocks.redirect.mockImplementation(() => { throw mocks.redirectError; });
});

describe.each([
  ["admin", "/v2/admin/finance?tab=invoices"],
  ["client", "/v2/client/finance"],
] as const)("%s invoice summary", (portal, returnHref) => {
  it("renders a read-only summary with AUD totals, status, Sydney dates and the return link", async () => {
    const { container } = render(await InvoiceSummaryPage({ id: "inv-1", portal }));

    expect(mocks.summary).toHaveBeenCalledOnce();
    expect(mocks.summary).toHaveBeenCalledWith("inv-1", portal);
    expect(screen.getByRole("heading", { level: 1, name: "INV-2026-0042" })).toBeVisible();
    expect(screen.getByText("PARTIALLY PAID")).toBeVisible();
    expectDetail("Invoice total", "$1,234.50");
    expectDetail("Service period", "1 Sept 2026 - 8 Sept 2026");
    expectDetail("Created", "9 Sept 2026");
    expectDetail("Sent", "10 Sept 2026");
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("href", returnHref);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector("form, input, select, textarea, [contenteditable='true']")).toBeNull();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows Not sent when there is no sent date", async () => {
    mocks.summary.mockResolvedValue({ ...invoice(), sentAt: null });
    render(await InvoiceSummaryPage({ id: "inv-1", portal }));
    expectDetail("Sent", "Not sent");
  });

  it.each([
    [null, null, "Not specified"],
    [null, new Date("2026-09-07T14:30:00Z"), "Not specified - 8 Sept 2026"],
    [new Date("2026-08-31T14:30:00Z"), null, "1 Sept 2026 - Not specified"],
  ] as const)("renders missing period dates (start=%s, end=%s)", async (periodStart, periodEnd, expected) => {
    mocks.summary.mockResolvedValue({ ...invoice(), periodStart, periodEnd });
    render(await InvoiceSummaryPage({ id: "inv-1", portal }));
    expectDetail("Service period", expected);
    expectDetail("Invoice total", "$1,234.50");
  });

  it("uses not-found navigation for an absent invoice", async () => {
    mocks.summary.mockResolvedValue(null);
    await expect(InvoiceSummaryPage({ id: "missing", portal })).rejects.toBe(mocks.notFoundError);
    expect(mocks.summary).toHaveBeenCalledOnce();
    expect(mocks.summary).toHaveBeenCalledWith("missing", portal);
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("uses not-found navigation for forbidden access", async () => {
    mocks.summary.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(InvoiceSummaryPage({ id: "inv-1", portal })).rejects.toBe(mocks.notFoundError);
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated requests to the v2 login", async () => {
    mocks.summary.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(InvoiceSummaryPage({ id: "inv-1", portal })).rejects.toBe(mocks.redirectError);
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/v2/login");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it.each([new Error("Invoice service unavailable"), "FORBIDDEN"])(
    "propagates unexpected failures unchanged (%s)", async (error) => {
      mocks.summary.mockRejectedValue(error);
      await expect(InvoiceSummaryPage({ id: "inv-1", portal })).rejects.toBe(error);
      expect(mocks.notFound).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
