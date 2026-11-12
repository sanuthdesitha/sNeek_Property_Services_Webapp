import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ClientHomePage from "@/app/v2/client/page";

/**
 * Client Home (phone board 1) and dashboard (desktop board) render from one
 * load. Both compositions are in the DOM (CSS picks one), so the phone section
 * is read through its container and the desktop through the KPI cards.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), scope: vi.fn(), portal: vi.fn(), jobs: vi.fn(), reports: vi.fn(),
  finance: vi.fn(), properties: vi.fn(), stocks: vi.fn(), laundry: vi.fn(), attention: vi.fn(),
  viewer: vi.fn(), approvals: vi.fn(), quotes: vi.fn(), message: vi.fn(), cases: vi.fn(), users: vi.fn(), jobIds: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated", data: null }) }));
vi.mock("@/lib/auth/client-portal", () => ({
  requireClientPortalPage: mocks.auth, propertyScopeWhere: mocks.scope,
}));
vi.mock("@/lib/client/property-home", () => ({ loadPropertyHomeRows: mocks.properties }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: mocks.portal }));
vi.mock("@/lib/client/portal-data", () => ({
  listClientJobsForUser: mocks.jobs, listClientReportsForUser: mocks.reports,
}));
vi.mock("@/lib/billing/client-portal-finance", () => ({ getClientFinanceOverview: mocks.finance }));
vi.mock("@/lib/dashboard/immediate-attention", () => ({ getClientImmediateAttention: mocks.attention }));
vi.mock("@/lib/commercial/client-approval-access", () => ({
  resolveApprovalViewer: mocks.viewer, listApprovalsForViewer: mocks.approvals,
}));
vi.mock("@/lib/db", () => ({ db: {
  property: { findMany: mocks.properties }, propertyStock: { findMany: mocks.stocks },
  laundryTask: { findMany: mocks.laundry }, quote: { findMany: mocks.quotes },
  clientMessage: { findFirst: mocks.message }, issueTicket: { groupBy: mocks.cases },
  user: { findMany: mocks.users }, job: { findMany: mocks.jobIds },
} }));
vi.mock("@/components/v2/client/report-download-button", () => ({
  EstateReportDownloadButton: () => <button>PDF</button>,
}));

function context() {
  return {
    userId: "user-1", userName: "Alex Client", clientId: "client-1", actor: "CLIENT",
    propertyIds: null as string[] | null, team: null,
    permissions: { messages: true, properties: true, reports: true, invoicesView: true, bookings: true, maintenance: true },
    visibility: {
      showProperties: true, showInventory: true, showReports: true, showFinanceDetails: true,
      showBooking: true, showCases: true, showShopping: true, showQuoteRequests: true,
      showApprovals: true, showLaundryUpdates: true, showLaundryCosts: true, showJobs: true,
      showCleanerNames: true, showReportDownloads: true, showCalendar: false,
    },
  };
}
const futureJob = {
  id: "job-1", status: "ASSIGNED", scheduledDate: new Date("2099-09-09T00:00:00Z"),
  jobType: "REGULAR_CLEAN", startTime: "10:00", dueTime: "13:30", assignments: [],
  property: { id: "property-1", name: "Harbour apartment", suburb: "Sydney" },
};
function money(total: number) {
  return { rows: [], toPay: { total, primary: null, outstandingCount: 0 }, termsKnown: true };
}
function kpi(label: string) {
  return within(screen.getByText(label, { selector: ".e-eyebrow" }).parentElement!);
}
function phone() {
  return within(document.querySelector(".lg\\:hidden:not(p):not(span)") as HTMLElement);
}
function expectRetry(sections?: string[]) {
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Some dashboard data could not be loaded");
  for (const section of sections ?? []) expect(alert).toHaveTextContent(section);
  expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/v2/client");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(context());
  mocks.scope.mockReturnValue({ clientId: "client-1" });
  mocks.portal.mockResolvedValue({ clientId: "client-1", client: { name: "Client company" } });
  for (const query of [mocks.jobs, mocks.reports, mocks.properties, mocks.stocks, mocks.laundry, mocks.attention,
    mocks.approvals, mocks.quotes, mocks.cases, mocks.users, mocks.jobIds]) {
    query.mockResolvedValue([]);
  }
  mocks.viewer.mockResolvedValue({ userId: "user-1", email: null, clientIds: new Set(["client-1"]) });
  mocks.message.mockResolvedValue(null);
  mocks.finance.mockResolvedValue({ summary: { pendingChargeTotal: 0, pendingChargeCount: 0 }, money: money(0) });
});

describe("client home and dashboard reliability", () => {
  it("shows genuine empty results and zero money without a retry warning", async () => {
    render(await ClientHomePage());
    expect(phone().getByText("No upcoming cleans")).toBeVisible();
    expect(phone().getByText("No reports available")).toBeVisible();
    expect(screen.getByText("No properties found for this account.")).toBeVisible();
    expect(kpi("Happening now").getByText("Nothing in progress")).toBeVisible();
    expect(kpi("Waiting for you").getByText("0")).toBeVisible();
    expect(kpi("To pay").getByText("$0.00")).toBeVisible();
    expect(kpi("Low stock").getByText("All topped up")).toBeVisible();
    expect(screen.getByText("No messages from the team yet.")).toBeVisible();
    expect(screen.queryByText(/approvals? waiting/)).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("does not advertise an empty schedule when jobs fail, preserves reports and recovers", async () => {
    mocks.jobs.mockRejectedValueOnce(new Error("offline"));
    mocks.reports.mockResolvedValue([{ id: "report-1", job: futureJob }]);
    const view = render(await ClientHomePage());
    expectRetry(["Services"]);
    expect(phone().getByText("Upcoming cleans unavailable.")).toBeVisible();
    expect(kpi("Happening now").getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText(/No upcoming cleans|Nothing in progress/)).not.toBeInTheDocument();
    expect(phone().getByText("Last report · Harbour apartment")).toBeVisible();
    expect(kpi("To pay").getByText("$0.00")).toBeVisible();
    view.rerender(await ClientHomePage());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(phone().getByText("No upcoming cleans")).toBeVisible();
  });

  it("shows the live clean, upcoming cleans and the decisions waiting", async () => {
    const today = new Date();
    mocks.jobs.mockResolvedValue([
      { ...futureJob, id: "live", status: "IN_PROGRESS", scheduledDate: today, assignments: [{ user: { name: "Jane C." } }] },
      futureJob,
      { ...futureJob, id: "open", status: "UNASSIGNED", property: { id: "p2", name: "Bronte Flat", suburb: "Bronte" } },
    ]);
    mocks.approvals.mockResolvedValue([{ id: "a", title: "Inside oven", amount: 45, currency: "AUD", propertyId: "property-1" }]);
    mocks.quotes.mockResolvedValue([{ id: "q", serviceType: "END_OF_LEASE", totalAmount: 640, validUntil: null, createdAt: new Date("2026-11-01T00:00:00Z") }]);
    render(await ClientHomePage());
    const live = phone().getByText("Happening now").closest("a")!;
    expect(live).toHaveAttribute("href", "/v2/client/jobs/live");
    expect(within(live).getByText("On site")).toBeVisible();
    expect(within(live).getByText(/Jane C\. · planned 10:00 · finish about 13:30/)).toBeVisible();
    expect(phone().getByText("2 approvals waiting")).toBeVisible();
    expect(phone().getByText("$685.00")).toBeVisible();
    expect(phone().getByRole("link", { name: "Review approvals" })).toHaveAttribute("href", "/v2/client/approvals");
    expect(phone().getByText("Confirmed")).toBeVisible();
    expect(phone().getByText("Awaiting cleaner")).toBeVisible();
    expect(kpi("Waiting for you").getByText("2")).toBeVisible();
    // Quotes are read for the account holder without marking them viewed.
    expect(mocks.quotes).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: "client-1", status: "SENT" } }));
  });

  it("reads no decisions when approvals are switched off for this client", async () => {
    const ctx = context();
    ctx.visibility.showApprovals = false;
    mocks.auth.mockResolvedValue(ctx);
    render(await ClientHomePage());
    expect(mocks.approvals).not.toHaveBeenCalled();
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(screen.queryByText("Waiting for you")).toBeNull();
    expect(screen.queryByText(/approvals? waiting/)).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides cleaner names when the per-client switch is off", async () => {
    const ctx = context();
    ctx.visibility.showCleanerNames = false;
    mocks.auth.mockResolvedValue(ctx);
    mocks.jobs.mockResolvedValue([{ ...futureJob, status: "IN_PROGRESS", scheduledDate: new Date(), assignments: [{ user: { name: "Jane C." } }] }]);
    render(await ClientHomePage());
    expect(phone().getByText("Happening now")).toBeVisible();
    expect(screen.queryByText(/Jane C\./)).toBeNull();
  });

  it.each([
    ["reports", "Reports unavailable.", "No reports available", "Reports"],
    ["properties", "Properties unavailable.", "No properties found for this account.", "Properties"],
    ["laundry", null, null, "Laundry"],
  ] as const)("isolates %s failures while retaining the next job and finance", async (query, unavailable, empty, section) => {
    mocks[query].mockRejectedValue(new Error("offline"));
    mocks.jobs.mockResolvedValue([futureJob]);
    mocks.finance.mockResolvedValue({ summary: { pendingChargeTotal: 123.45, pendingChargeCount: 2 }, money: money(123.45) });
    render(await ClientHomePage());
    expectRetry([section]);
    if (unavailable) expect(screen.getAllByText(unavailable).length).toBeGreaterThan(0);
    if (empty) expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(phone().getByText("Harbour apartment")).toBeVisible();
    expect(kpi("To pay").getByText("$123.45")).toBeVisible();
  });

  it.each(["rejected", "null"])("never substitutes zero money for %s finance", async (mode) => {
    if (mode === "rejected") mocks.finance.mockRejectedValue(new Error("offline"));
    else mocks.finance.mockResolvedValue(null);
    render(await ClientHomePage());
    expectRetry(["Finance"]);
    expect(kpi("To pay").getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getByText("Invoices unavailable.")).toBeVisible();
  });

  it("does not claim all clear when attention or decisions fail", async () => {
    mocks.attention.mockRejectedValue(new Error("offline"));
    mocks.approvals.mockRejectedValue(new Error("offline"));
    render(await ClientHomePage());
    expectRetry(["Attention", "Approvals"]);
    expect(phone().getByText("Attention unavailable.")).toBeVisible();
    expect(phone().getByText("Approvals unavailable.")).toBeVisible();
    expect(kpi("Waiting for you").getByText("Unavailable")).toBeVisible();
  });

  it.each([false, true])("distinguishes empty inventory from failed inventory (failed=%s)", async (failed) => {
    const ctx = context();
    ctx.visibility.showFinanceDetails = false;
    mocks.auth.mockResolvedValue(ctx);
    if (failed) mocks.stocks.mockRejectedValue(new Error("offline"));
    render(await ClientHomePage());
    expect(failed ? kpi("Low stock").getByText("Unavailable") : kpi("Low stock").getByText("0")).toBeVisible();
    expect(mocks.finance).not.toHaveBeenCalled();
    expect(screen.queryByText("To pay")).toBeNull();
    if (failed) {
      expectRetry(["Inventory"]);
      expect(screen.queryByText("All topped up")).not.toBeInTheDocument();
    } else {
      expect(screen.getByText("All topped up")).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  });

  it.each(["rejected", "missing client"])("marks dependent panels unavailable for %s portal context", async (mode) => {
    if (mode === "rejected") mocks.portal.mockRejectedValue(new Error("offline"));
    else mocks.portal.mockResolvedValue({ clientId: null, client: null });
    mocks.jobs.mockResolvedValue([futureJob]);
    render(await ClientHomePage());
    expectRetry(["Account", "Properties", "Inventory", "Laundry", "Attention"]);
    expect(screen.getByText("Properties unavailable.")).toBeVisible();
    for (const label of ["To pay", "Low stock"]) expect(kpi(label).getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(phone().getByText("Harbour apartment")).toBeVisible();
    for (const query of [mocks.properties, mocks.stocks, mocks.laundry, mocks.finance, mocks.attention, mocks.quotes]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])("hides restricted VA features and message links with next job=%s", async (hasJob) => {
    const ctx = context();
    ctx.actor = "VA";
    for (const permission of Object.keys(ctx.permissions) as (keyof typeof ctx.permissions)[]) ctx.permissions[permission] = false;
    mocks.auth.mockResolvedValue(ctx);
    mocks.jobs.mockResolvedValue(hasJob ? [futureJob] : []);
    render(await ClientHomePage());
    for (const path of ["reports", "properties", "messages", "booking", "quote", "inventory", "shopping", "approvals", "finance"]) {
      expect(document.querySelector(`a[href="/v2/client/${path}"]`)).toBeNull();
    }
    for (const label of ["Your properties", "To pay", "Low stock", "Waiting for you", "Invoices", "Messages", "Book a clean"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    for (const query of [mocks.reports, mocks.properties, mocks.stocks, mocks.finance, mocks.approvals, mocks.quotes, mocks.message]) {
      expect(query).not.toHaveBeenCalled();
    }
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
    mocks.jobIds.mockResolvedValue([{ id: "job-in-scope" }]);
    render(await ClientHomePage());
    expectRetry(["Reports"]);
    expect(screen.getAllByText("Reports unavailable.").length).toBeGreaterThan(0);
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
    // The latest office message is read inside the assistant's job scope.
    expect(mocks.message).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      clientId: "client-1", isFromAdmin: true, OR: [{ jobId: null }, { jobId: { in: ["job-in-scope"] } }],
    }) }));
    // Decisions are the account holder's: never read for an assistant.
    expect(mocks.approvals).not.toHaveBeenCalled();
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
});
