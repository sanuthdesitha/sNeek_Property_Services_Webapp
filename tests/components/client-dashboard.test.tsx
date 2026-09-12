import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ClientHomePage from "@/app/v2/client/page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), scope: vi.fn(), portal: vi.fn(), jobs: vi.fn(), reports: vi.fn(),
  finance: vi.fn(), properties: vi.fn(), stocks: vi.fn(), laundry: vi.fn(), attention: vi.fn(),
}));
vi.mock("@/lib/auth/client-portal", () => ({
  requireClientPortalPage: mocks.auth, propertyScopeWhere: mocks.scope,
}));
vi.mock("@/lib/client/property-home", () => ({ loadPropertyHomeRows: mocks.properties }));
vi.mock("@/components/v2/client/property-portfolio", () => ({ PropertyPortfolio: () => <div>Property portfolio</div> }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: mocks.portal }));
vi.mock("@/lib/client/portal-data", () => ({
  listClientJobsForUser: mocks.jobs, listClientReportsForUser: mocks.reports,
}));
vi.mock("@/lib/billing/client-portal-finance", () => ({ getClientFinanceOverview: mocks.finance }));
vi.mock("@/lib/dashboard/immediate-attention", () => ({ getClientImmediateAttention: mocks.attention }));
vi.mock("@/lib/db", () => ({ db: {
  property: { findMany: mocks.properties }, propertyStock: { findMany: mocks.stocks },
  laundryTask: { findMany: mocks.laundry },
} }));
vi.mock("@/components/v2/client/report-download-button", () => ({
  EstateReportDownloadButton: () => <button>PDF</button>,
}));

function context() {
  return {
    userId: "user-1", userName: "Alex Client", clientId: "client-1", actor: "CLIENT",
    propertyIds: null as string[] | null,
    permissions: { messages: true, properties: true, reports: true, invoicesView: true, bookings: true, maintenance: true },
    visibility: {
      showProperties: true, showInventory: true, showReports: true, showFinanceDetails: true,
      showBooking: true, showCases: true, showShopping: true, showQuoteRequests: true,
      showApprovals: true, showLaundryUpdates: true, showLaundryCosts: true,
      showCleanerNames: true, showReportDownloads: true,
    },
  };
}
const job = {
  id: "job-1", status: "ASSIGNED", scheduledDate: new Date("2099-09-09T00:00:00Z"),
  jobType: "REGULAR_CLEAN", startTime: "10:00", assignments: [],
  property: { id: "property-1", name: "Harbour apartment", suburb: "Sydney" },
};
function tile(label: string) {
  return within(screen.getByText(label).parentElement!.parentElement!);
}
function expectRetry() {
  expect(screen.getByRole("alert")).toHaveTextContent("Some dashboard data could not be loaded");
  expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/v2/client");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(context());
  mocks.scope.mockReturnValue({ clientId: "client-1" });
  mocks.portal.mockResolvedValue({ clientId: "client-1", client: { name: "Client company" } });
  for (const query of [mocks.jobs, mocks.reports, mocks.properties, mocks.stocks, mocks.laundry, mocks.attention]) {
    query.mockResolvedValue([]);
  }
  mocks.finance.mockResolvedValue({ summary: { pendingChargeTotal: 0, pendingChargeCount: 0 } });
});

describe("client dashboard reliability", () => {
  it("shows genuine empty results and zero money without a retry warning", async () => {
    render(await ClientHomePage());
    expect(screen.getByText("No active services scheduled right now.")).toBeVisible();
    expect(screen.getByText("No upcoming services")).toBeVisible();
    expect(screen.getByText("No reports available")).toBeVisible();
    expect(screen.getByText("No properties found for this account.")).toBeVisible();
    expect(screen.getByText("No inventory tracked yet.")).toBeVisible();
    expect(screen.getByText("No laundry updates.")).toBeVisible();
    expect(tile("Today").getByText("0")).toBeVisible();
    expect(tile("Needs you").getByText("0")).toBeVisible();
    expect(tile("Unbilled work").getByText("$0.00")).toBeVisible();
    expect(screen.getByRole("link", { name: "Message ops" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("does not advertise an empty schedule when jobs fail, preserves reports and recovers", async () => {
    mocks.jobs.mockRejectedValueOnce(new Error("offline"));
    mocks.reports.mockResolvedValue([{ id: "report-1", job }]);
    const view = render(await ClientHomePage());
    expectRetry();
    expect(screen.getByText("Next service unavailable.")).toBeVisible();
    expect(screen.getByText("Upcoming services unavailable.")).toBeVisible();
    for (const label of ["Today", "Next clean"]) expect(tile(label).getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText(/No active services|No upcoming services|Nothing scheduled|Nothing upcoming/)).not.toBeInTheDocument();
    expect(screen.getByText("Harbour apartment")).toBeVisible();
    expect(tile("Unbilled work").getByText("$0.00")).toBeVisible();
    view.rerender(await ClientHomePage());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No upcoming services")).toBeVisible();
  });

  it.each([
    ["reports", "Reports unavailable.", "No reports available"],
    ["properties", "Properties unavailable.", "No properties found for this account."],
    ["stocks", "Inventory unavailable.", "No inventory tracked yet."],
    ["laundry", "Laundry unavailable.", "No laundry updates."],
  ] as const)("isolates %s failures while retaining the next job and finance", async (query, unavailable, empty) => {
    mocks[query].mockRejectedValue(new Error("offline"));
    mocks.jobs.mockResolvedValue([job]);
    mocks.finance.mockResolvedValue({ summary: { pendingChargeTotal: 123.45, pendingChargeCount: 2 } });
    render(await ClientHomePage());
    expectRetry();
    expect(screen.getByText(unavailable)).toBeVisible();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.getAllByText("Harbour apartment").length).toBeGreaterThan(0);
    expect(tile("Unbilled work").getByText("$123.45")).toBeVisible();
    expect(tile("Unbilled work").getByText("2 services awaiting invoice")).toBeVisible();
  });

  it.each(["rejected", "null"])("never substitutes zero money for %s finance", async (mode) => {
    if (mode === "rejected") mocks.finance.mockRejectedValue(new Error("offline"));
    else mocks.finance.mockResolvedValue(null);
    render(await ClientHomePage());
    expectRetry();
    expect(tile("Unbilled work").getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0 services awaiting invoice")).not.toBeInTheDocument();
    expect(screen.getByText("No reports available")).toBeVisible();
  });

  it("does not claim all clear when attention fails", async () => {
    mocks.attention.mockRejectedValue(new Error("offline"));
    render(await ClientHomePage());
    expectRetry();
    expect(tile("Needs you").getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("Nothing waiting")).not.toBeInTheDocument();
  });

  it.each([false, true])("distinguishes empty inventory from failed inventory (failed=%s)", async (failed) => {
    const ctx = context();
    ctx.visibility.showFinanceDetails = false;
    mocks.auth.mockResolvedValue(ctx);
    if (failed) mocks.stocks.mockRejectedValue(new Error("offline"));
    render(await ClientHomePage());
    expect(tile("Low stock").getByText(failed ? "Unavailable" : "0")).toBeVisible();
    expect(mocks.finance).not.toHaveBeenCalled();
    if (failed) {
      expectRetry();
      expect(screen.queryByText("All topped up")).not.toBeInTheDocument();
    } else {
      expect(screen.getByText("All topped up")).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  });

  it.each(["rejected", "missing client"])("marks dependent panels unavailable for %s portal context", async (mode) => {
    if (mode === "rejected") mocks.portal.mockRejectedValue(new Error("offline"));
    else mocks.portal.mockResolvedValue({ clientId: null, client: null });
    mocks.jobs.mockResolvedValue([job]);
    render(await ClientHomePage());
    expectRetry();
    for (const section of ["Properties", "Inventory", "Laundry"]) {
      expect(screen.getByText(`${section} unavailable.`)).toBeVisible();
    }
    for (const label of ["Unbilled work", "Needs you"]) expect(tile(label).getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("Harbour apartment").length).toBeGreaterThan(0);
    for (const query of [mocks.properties, mocks.stocks, mocks.laundry, mocks.finance, mocks.attention]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])("hides restricted VA features and message links with next job=%s", async (hasJob) => {
    const ctx = context();
    ctx.actor = "VA";
    for (const permission of Object.keys(ctx.permissions) as (keyof typeof ctx.permissions)[]) ctx.permissions[permission] = false;
    mocks.auth.mockResolvedValue(ctx);
    mocks.jobs.mockResolvedValue(hasJob ? [job] : []);
    render(await ClientHomePage());
    for (const path of ["reports", "properties", "messages", "booking", "quote", "inventory", "shopping"]) {
      expect(document.querySelector(`a[href="/v2/client/${path}"]`)).toBeNull();
    }
    for (const label of ["Recent reports", "Your properties", "Unbilled work", "Low stock"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    for (const query of [mocks.reports, mocks.properties, mocks.stocks, mocks.finance]) expect(query).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.attention).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({
      showApprovals: false, showInventory: false, showCases: false,
    }) }));
  });

  it("keeps permitted VA queries scoped through the existing helpers", async () => {
    const ctx = context();
    ctx.actor = "VA";
    ctx.userId = "va-1";
    ctx.propertyIds = ["property-1"];
    const propertyWhere = { clientId: "client-1", id: { in: ctx.propertyIds } };
    mocks.auth.mockResolvedValue(ctx);
    mocks.scope.mockReturnValue(propertyWhere);
    mocks.reports.mockRejectedValue(new Error("offline"));
    render(await ClientHomePage());
    expectRetry();
    expect(screen.getByText("Reports unavailable.")).toBeVisible();
    expect(document.querySelector('a[href="/v2/client/reports"]')).not.toBeNull();
    expect(mocks.scope).toHaveBeenCalledWith(ctx);
    expect(mocks.portal).toHaveBeenCalledWith("va-1");
    expect(mocks.jobs).toHaveBeenCalledWith("va-1");
    expect(mocks.reports).toHaveBeenCalledWith("va-1");
    expect(mocks.finance).toHaveBeenCalledWith("client-1", ["property-1"]);
    expect(mocks.properties).toHaveBeenCalledWith(ctx);
    for (const query of [mocks.stocks, mocks.laundry]) {
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: { property: propertyWhere } }));
    }
    expect(mocks.attention).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-1", propertyIds: ["property-1"] }));
  });
});
