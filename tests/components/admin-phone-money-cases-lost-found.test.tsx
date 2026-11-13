import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phone layouts (below 640px, boards "Admin phone: Invoices and pay" and
 * "Admin phone: Cases and Lost and found"): every desktop action stays
 * reachable, and from 640px up the phone furniture is not in the page.
 */
vi.mock("next/navigation", () => ({ useSearchParams: () => null, usePathname: () => "/v2/admin/finance", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { InvoiceList } from "@/components/v2/admin/finance/invoices/invoice-list";
import { NewInvoiceSheet } from "@/components/v2/admin/finance/invoices/new-invoice-sheet";
import { CaseQueueChips } from "@/components/v2/admin/cases/case-queues";
import { CaseDetailsPanel } from "@/components/v2/admin/cases/case-details-panel";
import type { CaseDetail } from "@/components/v2/admin/cases/case-types";
import { LostFoundFilters } from "@/components/v2/admin/lost-found/lost-found-filters";
import { DEFAULT_VIEW } from "@/components/v2/admin/lost-found/lost-found-view";

function phoneMedia(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("min-width") ? !phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const counts = { all: 3, active: 3, needsAction: 2, overdue: 1, byStatus: { DRAFT: 1, APPROVED: 1, SENT: 1, PART_PAID: 0, PAID: 0, VOID: 0 } };
function rowFor(id: string, status: string, number: string) {
  return { id, invoiceNumber: number, status, totalAmount: 100, paidAmount: null, amountOwing: 100, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-15T23:59:59.999Z",
    sentAt: null, paidAt: null, paidDate: null, paymentMethod: null, paymentReference: null, createdAt: "2026-10-16T00:00:00.000Z", dueDate: "2026-10-30",
    overdue: false, xeroInvoiceId: null, xeroExportedAt: null, xeroState: "NONE", client: { id: "c1", name: "Client One", email: null } };
}
const payload = { rows: [rowFor("d1", "DRAFT", "INV-1")], total: 1, page: 1, pageSize: 25, pageCount: 1, sort: "created", dir: "desc", counts, paymentTermsDays: 14, today: "2026-11-11" };

describe("Client invoices on a phone", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/v2/admin/finance?tab=invoices");
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("view=context")) return Promise.resolve(new Response(JSON.stringify({ clients: [{ id: "c1", name: "Client One", email: null }], properties: [] })));
      if (url.includes("view=stats")) return Promise.resolve(new Response(JSON.stringify({ error: "stats off" }), { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(payload)));
    }));
  });

  it("docks New invoice, opens the chooser, and Continue opens the same dialog the header menu opens", async () => {
    phoneMedia(true);
    render(<InvoiceList />);
    await screen.findAllByText("INV-1");
    const bar = screen.getByRole("region", { name: "Client invoice actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "New invoice" }));
    const sheet = screen.getByRole("dialog", { name: "New invoice" });
    fireEvent.click(within(sheet).getByRole("radio", { name: /Blank invoice/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Create blank invoice")).toBeInTheDocument());
  });

  it("keeps the status chips and puts search, client, period and Xero behind Filter with a result count", async () => {
    phoneMedia(true);
    render(<InvoiceList />);
    await screen.findAllByText("INV-1");
    expect(screen.getByRole("group", { name: "Invoice status" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search invoices")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = screen.getByRole("dialog", { name: "Filter client invoices" });
    expect(within(sheet).getByLabelText("Search invoices")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Show 1 invoice" })).toBeInTheDocument();
  });

  it("hides the docked button while rows are selected (the bulk bar owns the bottom)", async () => {
    phoneMedia(true);
    render(<InvoiceList />);
    await screen.findAllByText("INV-1");
    fireEvent.click(screen.getByRole("button", { name: /^Select/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-1" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Client invoice actions" })).toBeNull();
  });

  it("from 640px up: filters inline, no docked bar", async () => {
    phoneMedia(false);
    render(<InvoiceList />);
    await screen.findAllByText("INV-1");
    expect(screen.getByLabelText("Search invoices")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Client invoice actions" })).toBeNull();
  });

  it("the chooser refuses a credit note with the capability's words", () => {
    const onContinue = vi.fn();
    render(<NewInvoiceSheet open onOpenChange={() => undefined} creditRefusal="Needs the void and credit notes capability." onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("radio", { name: /Credit note/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Needs the void and credit notes capability.");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

const caseDetail = (patch: Partial<CaseDetail> = {}): CaseDetail => ({
  id: "c1", title: "Scratched bench top", description: "", severity: "MEDIUM", status: "OPEN", slaBreachAt: null, caseType: "DAMAGE",
  clientVisible: true, clientCanReply: true, resolutionNote: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  source: null, jobId: null, reportId: null, clientId: null, propertyId: null, comments: [], attachments: [], ...patch,
});

describe("Cases on a phone", () => {
  it("queues are one chip row with the server's counts", () => {
    const onQueue = vi.fn();
    render(<CaseQueueChips queue="needsReply" counts={{ needsReply: 2, unowned: 1, waitingClient: 4, slaRisk: 1, open: 9, resolved: 3, mine: 2, all: 12 }} onQueue={onQueue} />);
    const group = screen.getByRole("group", { name: "Queue" });
    expect(within(group).getByRole("button", { name: "Needs my reply 2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Unowned 1" }));
    expect(onQueue).toHaveBeenCalledWith("unowned");
  });

  it("Details / Next steps show one part while the other stays mounted, so a form draft survives switching", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const props = { detail: caseDetail(), linked: null, linkedStatus: "loading" as const, assignees: [], viewer: null, saving: false, onSave: vi.fn() };
    const { rerender } = render(<CaseDetailsPanel {...props} visiblePart="details" />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bench top, kitchen" } });
    expect(screen.getByRole("link", { name: "Create repair quote" }).closest("div")?.className).toContain("hidden");
    rerender(<CaseDetailsPanel {...props} visiblePart="next" />);
    expect(screen.getByRole("link", { name: "Create repair quote" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title").closest("fieldset")?.className).toBe("hidden");
    rerender(<CaseDetailsPanel {...props} visiblePart="details" />);
    expect(screen.getByLabelText("Title")).toHaveValue("Bench top, kitchen");
  });

  it("without a part (desktop and the sheet) everything shows as before", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<CaseDetailsPanel detail={caseDetail()} linked={null} linkedStatus="loading" assignees={[]} viewer={null} saving={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Title").closest("fieldset")?.className).toBe("flex min-w-0 flex-col gap-3");
    expect(screen.getByText("Next steps").className).toBe("e-eyebrow");
    expect(screen.getByText("Linked, filled in automatically")).toBeInTheDocument();
  });
});

describe("Lost and found on a phone", () => {
  it("search and filters sit behind Filter; Sort stays visible; an active filter is a removable chip", () => {
    phoneMedia(true);
    const onChange = vi.fn();
    render(<LostFoundFilters view={{ ...DEFAULT_VIEW, holding: true }} onChange={onChange} properties={[]} holdingDays={14} />);
    expect(screen.queryByRole("searchbox", { name: "Search" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Held over 14 days" }));
    expect(onChange).toHaveBeenCalledWith({ holding: false });
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    expect(within(screen.getByRole("dialog", { name: "Filter items" })).getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("from 640px up the filter row is inline as before", async () => {
    phoneMedia(false);
    render(<LostFoundFilters view={DEFAULT_VIEW} onChange={vi.fn()} properties={[]} holdingDays={14} />);
    await act(async () => undefined);
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Held over 14 days" })).toBeInTheDocument();
  });
});
