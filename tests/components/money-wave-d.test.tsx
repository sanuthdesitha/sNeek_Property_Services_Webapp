/**
 * Money Wave D on screen: Ready to bill with a dollar figure and "Create N
 * drafts", "N missing rates", "On send" in Due, Owing sortable, Push failed in
 * the Xero column, "Fix and review"; the editor's autosave with the stale
 * guard and the conflict banner, the Send options and their reasons, the Xero
 * account name, the checklist's fix links and saved-item suggestions.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => null, usePathname: () => "/v2/admin/finance" }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { invoiceColumns } from "@/components/v2/admin/finance/invoices/invoice-columns";
import { InvoiceStats } from "@/components/v2/admin/finance/invoices/invoice-stats";
import { invoiceActionLabel } from "@/components/v2/admin/finance/invoices/invoice-model";
import { InvoiceEditorPage } from "@/components/v2/admin/finance/invoices/editor/invoice-editor-page";
import { AUTOSAVE_DELAY_MS } from "@/components/v2/admin/finance/invoices/editor/use-invoice-editor";
import { agoText } from "@/components/v2/admin/finance/invoices/editor/editor-banners";
import { readArchiveSummary } from "@/components/v2/admin/finance/invoices/pdf-archive-download";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Row = ClientInvoiceEditorData["row"];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "inv", invoiceNumber: "INV-0421", status: "DRAFT", totalAmount: 110, paidAmount: null, amountOwing: 110,
    periodStart: "2026-10-16T00:00:00.000Z", periodEnd: "2026-10-31T00:00:00.000Z", sentAt: null, paidAt: null, paidDate: null,
    paymentMethod: null, paymentReference: null, createdAt: "2026-11-01T00:00:00.000Z", dueDate: "2026-11-15", paymentTermsDays: 14, overdue: false,
    xeroInvoiceId: null, xeroExportedAt: null, xeroState: "NONE", xeroPushFailure: null, xeroSync: null, missingRateJobs: 0,
    client: { id: "c1", name: "Harbour View Stays", email: "accounts@harbour.test" },
    kind: "INVOICE", clientReference: null, creditedAmount: 0, fullyCredited: false, credits: null, creditedBy: [],
    ...overrides,
  };
}

function cell(key: string, invoice: Row) {
  const column = invoiceColumns({ today: "2026-11-12", termsDays: 14, renderActions: () => null }).find((entry) => entry.key === key)!;
  return render(<div>{column.cell(invoice)}</div>);
}

describe("client invoice list (Wave D)", () => {
  it("shows On send with the terms for an unsent invoice, and sorts Owing on the server", () => {
    cell("due", row());
    expect(screen.getByText(/On send/)).toHaveTextContent("On send · 14-day terms");
    const owing = invoiceColumns({ today: "2026-11-12", termsDays: 14, renderActions: () => null }).find((entry) => entry.key === "owing")!;
    expect(owing.sortKey).toBe("owing");
  });

  it("distinguishes Push failed (with the provider's reason) from Push pending, and an unsent invoice from Not in Xero", () => {
    cell("xero", row({ xeroState: "PENDING", xeroPushFailure: { reason: "Xero API error (400): bad account", at: "2026-11-12T00:00:00.000Z" } }));
    expect(screen.getByText("Push failed")).toBeInTheDocument();
    expect(screen.getByText(/bad account/)).toBeInTheDocument();
    cleanup();
    cell("xero", row({ xeroState: "PENDING" }));
    expect(screen.getByText("Push pending")).toBeInTheDocument();
    cleanup();
    cell("xero", row());
    expect(screen.getByText("Not sent")).toBeInTheDocument();
  });

  it("marks a draft with jobs that have no rate, and leads it with Fix and review", () => {
    cell("status", row({ missingRateJobs: 1 }));
    expect(screen.getByText("1 job without a rate")).toBeInTheDocument();
    expect(invoiceActionLabel("edit", row({ missingRateJobs: 1 }))).toBe("Fix and review");
    expect(invoiceActionLabel("edit", row())).toBe("Review");
  });

  it("shows Ready to bill in dollars with Create N drafts, and the missing-rate count on Drafts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      readyToBill: { total: 3140, jobs: 22, clients: 4, unratedJobs: 3, blockedClients: 1 },
      drafts: { count: 6, total: 4820, missingRateDrafts: 2, missingRateJobs: 2 },
      outstanding: { count: 3, owing: 9260, overdue: 3, oldest: null },
      paidThisMonth: { count: 1, total: 100, monthStart: "2026-11-01" },
      invoicedThisMonth: { total: 0, invoiceCount: 0, invoiceTotal: 0, creditNoteCount: 0, creditTotal: 0, monthStart: "2026-11-01" },
    }))));
    const onCreateDrafts = vi.fn();
    render(<InvoiceStats reloadToken={0} canCreate onCreateDrafts={onCreateDrafts} />);
    expect(await screen.findByText("$3,140.00")).toBeInTheDocument();
    expect(screen.getByText(/22 finished jobs not on an invoice, 4 clients · 3 jobs have no rate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create 4 drafts" }));
    expect(onCreateDrafts).toHaveBeenCalled();
    expect(screen.getByText("2 missing rates")).toBeInTheDocument();
  });

  it("reads the archive summary header", () => {
    expect(readArchiveSummary(encodeURIComponent(JSON.stringify({ includedCount: 2, failed: [{ id: "b", invoiceNumber: "INV-2", reason: "x" }] })))).toMatchObject({ includedCount: 2 });
    expect(readArchiveSummary("not json")).toBeNull();
  });
});

function editorData(overrides: Partial<ClientInvoiceEditorData> = {}): ClientInvoiceEditorData {
  return {
    row: row(),
    timezone: "Australia/Sydney",
    paymentTermsDays: 14,
    updatedAt: "2026-11-11T01:00:00.000Z",
    subtotal: 100, gstAmount: 10, totalAmount: 110, gstEnabled: true, totalsMismatch: false, clientNote: null, startedWorkUnreadable: null,
    lines: [
      { id: "l1", description: "Airbnb turnover", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE", note: null, shoppingLocked: false, discount: false, discountPercent: null,
        job: { id: "j1", jobNumber: "J-1009", scheduledDay: "2026-10-18", property: { id: null, name: "The Bondi Studio", suburb: null } },
        propertyId: null, property: null, startedWork: null },
    ],
    clientProperties: [],
    editLock: { editable: true },
    canManage: true,
    checks: { appliesTo: "approve", items: [{ key: "rates", state: "refused", enforced: true, label: "1 job now have no client rate", detail: "J-1009", fixHref: "/v2/admin/clients/c1", fixLabel: "Set rates" }] },
    send: { defaultRecipients: ["accounts@harbour.test"], recipientsError: null, paymentLink: { available: false, reason: "No payment gateway is configured: the server has no Stripe key." } },
    xero: { state: "NONE", xeroInvoiceId: null, exportedAt: null, contactId: null, salesAccountCode: "200", salesAccountName: null, salesAccountNameReason: "Xero is not connected.", disbursementAccountCode: null, hasDisbursementLines: false, settingsError: null },
    history: [],
    startedWork: null,
    draft: { clients: [{ id: "c1", name: "Harbour View Stays" }, { id: "c2", name: "Northside Lets" }], clientTermsDays: 14, termsOverride: null, periodStartDay: "2026-10-16", periodEndDay: "2026-10-31", unbilledJobs: 3 },
    ...overrides,
  };
}

describe("invoice editor (Wave D)", () => {
  let patches: Array<{ body: Record<string, unknown> }>;
  let patchResponses: Array<() => Promise<Response>>;
  beforeEach(() => {
    patches = [];
    patchResponses = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push({ body: JSON.parse(String(init.body)) });
        return (patchResponses.shift() ?? (() => Promise.resolve(new Response("{}"))))();
      }
      if (url.includes("/saved-items")) return Promise.resolve(new Response(JSON.stringify({ items: [{ id: "k", name: "Key cut", rate: 15, gst: false }], updatedAt: null })));
      if (url.endsWith("/jobs")) return Promise.resolve(new Response(JSON.stringify({ total: 0, truncated: false, jobs: [] })));
      return Promise.resolve(new Response(JSON.stringify(editorData())));
    }));
  });

  it("shows editable Bill to, Period and Due, the real unbilled count, and the cards' reasons", () => {
    render(<InvoiceEditorPage initial={editorData()} backHref="/back" />);
    expect(screen.getByRole("combobox", { name: "Bill to" })).toHaveValue("c1");
    expect(screen.getByLabelText("Period from")).toHaveValue("2026-10-16");
    expect(screen.getByRole("combobox", { name: "Due" })).toHaveDisplayValue("Client terms (14 days)");
    expect(screen.getByRole("button", { name: "Add finished jobs (3 not billed)" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include payment link" })).toBeDisabled();
    expect(screen.getByText(/no Stripe key/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Attach PDF" })).toBeChecked();
    expect(screen.getByText("200 · name unavailable")).toBeInTheDocument();
    expect(screen.getByText("Blocks approval")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set rates" })).toHaveAttribute("href", "/v2/admin/clients/c1");
  });

  it("saves Bill to through the guarded PATCH", async () => {
    render(<InvoiceEditorPage initial={editorData()} backHref="/back" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Bill to" }), { target: { value: "c2" } });
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body).toEqual({ clientId: "c2", expectedUpdatedAt: "2026-11-11T01:00:00.000Z" });
  });

  it("autosaves typed edits after a pause, and on a conflict keeps them with Reload theirs / Keep my edits", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    patchResponses.push(() => Promise.resolve(new Response(JSON.stringify({ error: "Changed elsewhere.", code: "STALE_INVOICE", currentUpdatedAt: "2026-11-11T02:00:00.000Z" }), { status: 409 })));
    render(<InvoiceEditorPage initial={editorData()} backHref="/back" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Description of Airbnb turnover" }), { target: { value: "Airbnb turnover + linen" } });
    expect(patches).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50);
    });
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body).toMatchObject({ updateLines: [{ id: "l1", description: "Airbnb turnover + linen" }], expectedUpdatedAt: "2026-11-11T01:00:00.000Z" });
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByRole("button", { name: "Reload theirs" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Keep my edits and retry" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description of Airbnb turnover" })).toHaveValue("Airbnb turnover + linen");
    // No second autosave while the conflict stands.
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3);
    });
    expect(patches).toHaveLength(1);
    fireEvent.click(within(banner).getByRole("button", { name: "Keep my edits and retry" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1].body.updateLines).toEqual(patches[0].body.updateLines);
  });

  it("does not autosave while a line is invalid", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<InvoiceEditorPage initial={editorData()} backHref="/back" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity of Airbnb turnover" }), { target: { value: "0" } });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50);
    });
    expect(patches).toHaveLength(0);
    expect(await screen.findByText("Quantity must be more than zero.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("offers saved items while typing a new line, with the GST note when the flag differs", async () => {
    render(<InvoiceEditorPage initial={editorData()} backHref="/back" />);
    const input = screen.getByRole("combobox", { name: "New line description" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "key" } });
    const option = await screen.findByRole("option", { name: /Key cut/ });
    fireEvent.click(option);
    expect(input).toHaveValue("Key cut");
    expect(screen.getByRole("textbox", { name: "New line rate" })).toHaveValue("15.00");
    expect(screen.getByText(/saved as GST-free, but GST is on/)).toBeInTheDocument();
  });

  it("words the saved time", () => {
    expect(agoText(0, 2000)).toBe("just now");
    expect(agoText(0, 10_000)).toBe("10 seconds ago");
    expect(agoText(0, 125_000)).toBe("2 minutes ago");
  });
});
