import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PortfolioFilters } from "@/components/v2/admin/properties/list/portfolio-filters";
import { portfolioPhoneTone } from "@/components/v2/admin/properties/list/portfolio-columns";
import { PropertyPhoneActions } from "@/components/v2/admin/properties/detail/property-header";
import { PeopleTabs } from "@/components/v2/admin/people/people-tabs";
import { ClientPhoneActions } from "@/components/v2/admin/people/client-page/client-header-actions";
import { QuoteHeader } from "@/components/v2/admin/quotes/full/quote-header";
import { DEFAULT_PORTFOLIO_VIEW, type PortfolioView } from "@/components/v2/admin/properties/list/portfolio-view";
import type { PortfolioListResponse, PortfolioRow } from "@/lib/properties/portfolio-options";
import type { PeopleCounts } from "@/lib/people/counts";
import type { PropertyRecord } from "@/components/v2/admin/properties/detail/property-record";

/** Properties, People and Quotes on a phone (boards M-Properties, M-People2, M-QuotesMessages, 2026-11). */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const portfolio = {
  total: 4,
  counts: { attention: 4, "sync-error": 1, "key-lost": 1, "no-laundry-partner": 2, oneOff: 6 },
  facets: { clients: [{ id: "c1", name: "Harbour View Stays" }], suburbs: ["Glebe"] },
} as unknown as PortfolioListResponse;

function Filters({ initial }: { initial: Partial<PortfolioView> }) {
  const [view, setView] = React.useState<PortfolioView>({ ...DEFAULT_PORTFOLIO_VIEW, ...initial });
  return <PortfolioFilters view={view} data={portfolio} onChange={(patch) => setView((current) => ({ ...current, ...patch }))} />;
}

describe("Properties on a phone", () => {
  it("puts every filter behind one Filter button and keeps the view switch visible", async () => {
    setPhone(true);
    render(<Filters initial={{ clientId: "c1", includeOneOff: true }} />);
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search properties")).toBeNull();
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getAllByRole("button").map((button) => button.textContent)).toEqual(["Client: Harbour View Stays", "One-off sites shown"]);
    fireEvent.click(within(chips).getByRole("button", { name: "Remove filter One-off sites shown" }));
    expect(within(screen.getByRole("list", { name: "Active filters" })).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Filter · 1/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter properties" });
    expect(within(sheet).getByLabelText("Search properties")).toBeInTheDocument();
    expect(within(sheet).getByRole("group", { name: "Attention filters" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /Show one-off sites/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Show 4 properties" })).toBeInTheDocument();
  });

  it("keeps the inline filter row from 640px up", () => {
    setPhone(false);
    render(<Filters initial={{}} />);
    expect(screen.getByLabelText("Search properties")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Attention filters" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });

  it("bands a flagged property card by its worst flag, and leaves a clean one plain", () => {
    const row = (flags: string[]) => ({ flags }) as unknown as PortfolioRow;
    expect(portfolioPhoneTone(row([]))).toBeNull();
    expect(portfolioPhoneTone(row(["care-due"]))).toBe("attention");
    expect(portfolioPhoneTone(row(["care-due", "sync-error"]))).toBe("problem");
  });

  it("docks New job here (and Sync calendar when linked) on a phone only", () => {
    const property = { id: "p1", integration: { isEnabled: true, icalUrl: "https://example.com/ical" } } as unknown as PropertyRecord;
    setPhone(true);
    const { unmount } = render(<PropertyPhoneActions property={property} syncing={false} onSync={vi.fn()} />);
    const bar = screen.getByRole("region", { name: "Property actions" });
    expect(within(bar).getByRole("link", { name: "New job here" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Sync calendar" })).toBeEnabled();
    unmount();
    setPhone(false);
    render(<PropertyPhoneActions property={property} syncing={false} onSync={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Property actions" })).toBeNull();
  });
});

describe("People on a phone", () => {
  const counts = { clients: 18, cleaners: 14, office: 7, partners: 5, assistants: 7, invitationsOpen: 3 } as unknown as PeopleCounts;

  it("keeps the group tabs as one carousel with 44px links and the current group marked", () => {
    setPhone(true);
    render(<PeopleTabs active="assistants" counts={counts} access={{ clients: true, accounts: true } as never} onSelect={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "People groups" });
    expect(nav.className).toContain("overflow-x-auto");
    const current = within(nav).getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Assistants");
    expect(current.className).toContain("max-sm:min-h-11");
  });

  it("docks the client page's primary action: Chase overdue invoice beside Send update", () => {
    setPhone(true);
    const { unmount } = render(<ClientPhoneActions clientId="c1" overdueInvoice={{ id: "inv_1", invoiceNumber: "INV-0398" }} />);
    const bar = screen.getByRole("region", { name: "Client actions" });
    expect(within(bar).getByRole("link", { name: "Chase overdue invoice" })).toHaveAttribute("href", "/v2/admin/finance/invoices/inv_1");
    expect(within(bar).getByRole("link", { name: "Send update" })).toHaveAttribute("href", "/v2/admin/clients/c1?tab=messages");
    unmount();
    render(<ClientPhoneActions clientId="c1" overdueInvoice={null} />);
    expect(within(screen.getByRole("region", { name: "Client actions" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["Send update"]);
  });
});

describe("Quote page on a phone", () => {
  it("hides only the docked action in the header below 640px and keeps the rest", () => {
    setPhone(false);
    render(
      <QuoteHeader
        reference="Q-0230"
        title="Oven and window deep clean"
        statusLabel="Sent"
        statusTone="info"
        subLine="Harbour View Stays"
        secondary={[{ key: "pdf", label: "Preview PDF", onClick: vi.fn() }]}
        primary={{ key: "mark-won", label: "Mark won", onClick: vi.fn() }}
        save={null}
        moreItems={[{ key: "delete", label: "Delete quote", danger: true }]}
        phoneMovedKey="mark-won"
      />,
    );
    expect(screen.getByRole("button", { name: "Mark won" }).className).toContain("max-sm:hidden");
    expect(screen.getByRole("button", { name: "Preview PDF" }).className).not.toContain("max-sm:hidden");
    expect(screen.getByRole("button", { name: /More/ })).toBeInTheDocument();
  });
});
