import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readListState, writeListState, listApiQuery, DEFAULT_LIST_STATE } from "@/components/v2/admin/finance/invoices/use-invoice-list";

vi.mock("next/navigation", () => ({ useSearchParams: () => null, usePathname: () => "/v2/admin/finance", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { InvoiceList } from "@/components/v2/admin/finance/invoices/invoice-list";

const counts = { all: 3, active: 3, needsAction: 2, overdue: 1, byStatus: { DRAFT: 1, APPROVED: 1, SENT: 1, PART_PAID: 0, PAID: 0, VOID: 0 } };
function rowFor(id: string, status: string, number: string) {
  return { id, invoiceNumber: number, status, totalAmount: 100, paidAmount: null, amountOwing: 100, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-15T23:59:59.999Z",
    sentAt: null, paidAt: null, paidDate: null, paymentMethod: null, paymentReference: null, createdAt: "2026-10-16T00:00:00.000Z", dueDate: "2026-10-30",
    overdue: false, xeroInvoiceId: null, xeroExportedAt: null, xeroState: "NONE", client: { id: "c1", name: "Client One", email: null } };
}
function payload(rows: unknown[], total = rows.length) {
  return { rows, total, page: 1, pageSize: 25, pageCount: 1, sort: "created", dir: "desc", counts, paymentTermsDays: 14, today: "2026-11-11" };
}

describe("list URL state", () => {
  it("reads known values, falls back on unknown ones and leaves other params alone", () => {
    const state = readListState(new URLSearchParams("tab=invoices&status=SENT&sort=bogus&page=3&from=2026-13"));
    expect(state).toMatchObject({ status: "SENT", sort: "created", page: 3, from: "" });
    const written = writeListState(new URLSearchParams("tab=invoices&status=PAID"), { ...DEFAULT_LIST_STATE, sort: "total", dir: "asc" });
    expect(written.toString()).toBe("tab=invoices&sort=total&dir=asc");
    expect(listApiQuery(DEFAULT_LIST_STATE)).toContain("paginated=1");
  });
});

describe("InvoiceList", () => {
  const pending: Array<{ url: string; resolve: (response: Response) => void }> = [];
  beforeEach(() => {
    pending.length = 0;
    window.history.replaceState(null, "", "/v2/admin/finance?tab=invoices");
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("view=context")) return Promise.resolve(new Response(JSON.stringify({ clients: [{ id: "c1", name: "Client One", email: null }], properties: [] })));
      if (url.includes("view=stats")) return Promise.resolve(new Response(JSON.stringify({ error: "stats off in this test" }), { status: 500 }));
      return new Promise<Response>((resolve) => pending.push({ url, resolve }));
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows real chip counts, filters through the URL and ignores a late answer for an old filter", async () => {
    render(<InvoiceList />);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].url).toContain("status=needs-action");
    await act(async () => pending[0].resolve(new Response(JSON.stringify(payload([rowFor("d1", "DRAFT", "INV-1"), rowFor("a1", "APPROVED", "INV-2")])))));
    expect(await screen.findByText("INV-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs action 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Showing 1–2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("stats off in this test");

    // Choose "Sent", then "Paid" before the Sent answer arrives.
    fireEvent.click(screen.getByRole("button", { name: "Sent 1" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^Paid/ }));
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(window.location.search).toContain("status=PAID");
    expect(window.location.search).toContain("tab=invoices");
    await act(async () => pending[2].resolve(new Response(JSON.stringify(payload([], 0)))));
    await act(async () => pending[1].resolve(new Response(JSON.stringify(payload([rowFor("s1", "SENT", "INV-LATE")])))));
    expect(screen.queryByText("INV-LATE")).toBeNull();
    expect(screen.getByText("No invoices here")).toBeInTheDocument();
  });

  it("sorts from a header button and shows the bulk bar for a selection", async () => {
    render(<InvoiceList />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(new Response(JSON.stringify(payload([rowFor("d1", "DRAFT", "INV-1")])))));
    await screen.findByText("INV-1");
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Total/ })).getByRole("button"));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].url).toContain("sort=total");
    expect(pending[1].url).toContain("dir=desc"); // money columns open largest first
    await act(async () => pending[1].resolve(new Response(JSON.stringify({ ...payload([rowFor("d1", "DRAFT", "INV-1")]), sort: "total" }))));
    await screen.findByText("INV-1");
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-1" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("1 draft selected");
  });
});
