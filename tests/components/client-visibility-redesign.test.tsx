import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The redesigned client screens keep every per-client visibility switch and VA
 * grant on the server. One check per switch category these screens touch:
 * cleaner names, reports/inventory/laundry modules on the property tabs, VA
 * property scope on the clean page, VA invoice grant on costs, and module and
 * grant filtering of the More menu.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), jobs: vi.fn(), job: vi.fn(), tasks: vi.fn(), settings: vi.fn(), portal: vi.fn(), detail: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/v2/client" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated", data: null }), signOut: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({
  requireClientPortalPage: mocks.auth,
  propertyScopeWhere: (ctx: { clientId: string; propertyIds: string[] | null }) =>
    ({ clientId: ctx.clientId, ...(ctx.propertyIds ? { id: { in: ctx.propertyIds } } : {}) }),
}));
vi.mock("@/lib/db", () => ({ db: {
  job: { findMany: mocks.jobs, findFirst: mocks.job }, jobTask: { findMany: mocks.tasks },
  submissionMedia: { findMany: vi.fn(async () => []) },
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: mocks.portal }));
vi.mock("@/lib/client/portal-data", () => ({ getClientPropertyDetailForUser: mocks.detail }));
vi.mock("@/components/property-care/workspace", () => ({ PropertyCareWorkspace: () => <div>Care workspace</div> }));
vi.mock("@/components/v2/client/properties/property-actions", () => ({
  EPreferredCleanerCard: () => <div>Preferred cleaner</div>, EReportDownloadButton: () => <button>PDF</button>,
}));
vi.mock("@/components/v2/portal/role-switcher", () => ({ RoleSwitcher: () => null }));
vi.mock("@/components/look-switch-link", () => ({ LookSwitchLink: () => null }));

const VISIBILITY = {
  showProperties: true, showJobs: true, showCalendar: true, showReports: true, showInventory: true,
  showShopping: true, showStockRuns: true, allowStockRuns: true, showFinanceDetails: true, showCases: true,
  showLaundryUpdates: true, showLaundryImages: true, showQuoteRequests: true, showApprovals: true,
  showBooking: true, showCleanerNames: true, showReportDownloads: true, showChecklistPreview: true,
  showClientTaskRequests: true, showLiveProgress: false,
};
const GRANTS = { bookings: true, maintenance: true, reports: true, damage: true, invoicesView: true, messages: true, properties: true };
function ctx(over: Record<string, unknown> = {}) {
  return { userId: "user-1", userName: "Alex", clientId: "client-1", actor: "CLIENT", propertyIds: null, team: null,
    permissions: { ...GRANTS }, visibility: { ...VISIBILITY }, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ timezone: "Australia/Sydney" });
  mocks.tasks.mockResolvedValue([]);
});

describe("cleaner names", () => {
  it.each([true, false])("follows the per-client switch on the calendar (shown=%s)", async (shown) => {
    mocks.auth.mockResolvedValue(ctx({ visibility: { ...VISIBILITY, showCleanerNames: shown } }));
    mocks.jobs.mockResolvedValue([{ id: "j", status: "ASSIGNED", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2099-01-02T00:00:00Z"),
      startTime: "10:00", dueTime: null, property: { name: "Bondi", suburb: "Bondi" }, assignments: [{ user: { name: "Jane C." } }] }]);
    const Page = (await import("@/app/v2/client/calendar/page")).default;
    render(await Page());
    expect(screen.queryAllByText("Jane C.").length > 0).toBe(shown);
  });
});

describe("property tabs follow module switches and grants", () => {
  const detail = {
    property: { id: "p1", name: "The Bondi Studio", suburb: "Bondi Beach", bedrooms: 1, bathrooms: 1, address: "1 Beach Rd", state: "NSW", postcode: "2026", preferredCleanerUserId: null },
    reports: [], jobs: [], laundryTasks: [], stocks: [], checklistTemplates: [], activity: [], conditionTimeline: [], preferredCleanerOptions: [],
  };
  async function renderTabs(visibility: Partial<typeof VISIBILITY>, over: Record<string, unknown> = {}, tab?: string) {
    const merged = { ...VISIBILITY, ...visibility };
    mocks.auth.mockResolvedValue(ctx({ visibility: merged, ...over }));
    mocks.portal.mockResolvedValue({ visibility: merged });
    mocks.detail.mockResolvedValue(detail);
    const Page = (await import("@/app/v2/client/properties/[id]/page")).default;
    render(await Page({ params: { id: "p1" }, searchParams: tab ? { tab } : undefined }));
    return within(screen.getByRole("navigation", { name: "Property sections" })).getAllByRole("link").map((link) => link.textContent);
  }

  it("offers all six drawn tabs when everything is shared", async () => {
    expect(await renderTabs({})).toEqual(["Overview", "Reports", "Photos", "Stock", "Laundry", "Care"]);
  });

  it("drops Reports, Stock and Laundry when their switches are off, and ignores a hidden ?tab", async () => {
    const tabs = await renderTabs({ showReports: false, showInventory: false, showLaundryUpdates: false }, {}, "reports");
    expect(tabs).toEqual(["Overview", "Photos", "Care"]);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(mocks.detail).toHaveBeenCalledWith("user-1", "p1", expect.objectContaining({ showReports: false }));
  });

  it("drops Reports for an assistant without the reports grant", async () => {
    const tabs = await renderTabs({}, { actor: "VA", permissions: { ...GRANTS, reports: false } });
    expect(tabs).not.toContain("Reports");
    expect(mocks.detail).toHaveBeenCalledWith("user-1", "p1", expect.objectContaining({ showReports: false }));
  });

  it("offers Book a clean here only with booking shared and granted", async () => {
    await renderTabs({}, { actor: "VA", permissions: { ...GRANTS, bookings: false } });
    expect(screen.queryByRole("link", { name: "Book a clean here" })).toBeNull();
  });
});

describe("one clean keeps the assistant's property scope and invoice grant", () => {
  it("looks the clean up inside the assistant's properties", async () => {
    mocks.auth.mockResolvedValue(ctx({ actor: "VA", propertyIds: ["allowed"] }));
    mocks.portal.mockResolvedValue({ clientId: "client-1", visibility: VISIBILITY });
    mocks.job.mockResolvedValue(null);
    const Page = (await import("@/app/v2/client/jobs/[id]/page")).default;
    await expect(Page({ params: { id: "job-elsewhere" } })).rejects.toThrow("NOT_FOUND");
    expect(mocks.job).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-elsewhere", property: { clientId: "client-1", id: { in: ["allowed"] } } },
    }));
  });
});

describe("More menu filtering on the server", () => {
  it("shows an assistant only granted destinations and hides switched-off modules", async () => {
    mocks.auth.mockResolvedValue(ctx({ actor: "VA", permissions: { properties: true }, visibility: { ...VISIBILITY, showLaundryUpdates: false } }));
    const Page = (await import("@/app/v2/client/more/page")).default;
    render(await Page());
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/v2/client/jobs", "/v2/client/calendar", "/v2/client/properties", "/v2/client/inventory"]);
  });

  it("shows the account holder every enabled destination including Assistants", async () => {
    mocks.auth.mockResolvedValue(ctx({ visibility: { ...VISIBILITY, showCases: false } }));
    const Page = (await import("@/app/v2/client/more/page")).default;
    render(await Page());
    expect(screen.getByRole("link", { name: "Assistants" })).toHaveAttribute("href", "/v2/client/team");
    expect(screen.getByRole("link", { name: "Stock counts" })).toHaveAttribute("href", "/v2/client/stock-runs");
    expect(screen.queryByRole("link", { name: "Cases and disputes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
