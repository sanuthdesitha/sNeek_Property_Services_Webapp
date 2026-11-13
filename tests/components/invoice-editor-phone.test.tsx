import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientInvoiceEditorData, EditorLine } from "@/lib/billing/client-invoice-editor-types";

/**
 * Invoice editor on a phone (below 640px, board "Admin phone: Invoice
 * editor"): the total bar's button follows the stage, Move up / Move down use
 * the existing reorder save, the Add line sheet never works out an amount,
 * and from 640px up none of the phone furniture is in the page.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => null }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { InvoiceEditorPage } from "@/components/v2/admin/finance/invoices/editor/invoice-editor-page";

function data(overrides: Partial<ClientInvoiceEditorData> = {}): ClientInvoiceEditorData {
  return {
    row: {
      id: "inv", invoiceNumber: "INV-0421", status: "DRAFT", totalAmount: 110, paidAmount: null, amountOwing: 110,
      periodStart: "2026-10-16T00:00:00.000Z", periodEnd: "2026-10-31T00:00:00.000Z", sentAt: null, paidAt: null, paidDate: null,
      paymentMethod: null, paymentReference: null, createdAt: "2026-11-01T00:00:00.000Z", dueDate: "2026-11-15", overdue: false,
      xeroInvoiceId: null, xeroExportedAt: null, xeroState: "NONE", xeroPushFailure: null, missingRateJobs: 0, paymentTermsDays: 14, client: { id: "c1", name: "Harbour View Stays", email: "accounts@harbour.test" },
      kind: "INVOICE", clientReference: null, creditedAmount: 0, fullyCredited: false, credits: null, creditedBy: [],
    },
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
    checks: { appliesTo: "approve", items: [{ key: "totals", state: "ok", enforced: false, label: "Totals match the lines", detail: null }] },
    send: { defaultRecipients: ["accounts@harbour.test"], recipientsError: null, paymentLink: { available: false, reason: "No payment gateway is configured: the server has no Stripe key." } },
    xero: { state: "NONE", xeroInvoiceId: null, exportedAt: null, contactId: null, salesAccountCode: "200", salesAccountName: null, salesAccountNameReason: "Xero is not connected.", disbursementAccountCode: null, hasDisbursementLines: false, settingsError: null },
    history: [],
    startedWork: null,
    draft: null,
    ...overrides,
  };
}

type Call = { url: string; init?: RequestInit };
let calls: Call[];
const patches = () => calls.filter((call) => call.init?.method === "PATCH").map((call) => JSON.parse(String(call.init?.body)));

function phoneMedia(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("min-width") ? !phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const line = (id: string, property: string): EditorLine => ({
  ...data().lines[0],
  id,
  description: `Turnover ${id}`,
  job: { id: `j-${id}`, jobNumber: `J-${id}`, scheduledDay: "2026-10-18", property: { id: null, name: property, suburb: null } },
});
const mixed = [line("l1", "The Bondi Studio"), line("l2", "Albion Loft"), line("l3", "The Bondi Studio")];

function totalBar(): HTMLElement {
  return screen.getByRole("region", { name: "Invoice total" });
}

beforeEach(() => {
  calls = [];
  phoneMedia(true);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === "PATCH") return Promise.resolve(new Response(JSON.stringify({ ...data(), row: { ...data().row, status: "APPROVED" } })));
    return Promise.resolve(new Response(JSON.stringify(data())));
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Invoice editor on a phone", () => {
  it("draft: the total bar shows the server total, leads with Review, then Approve PATCHes the status", async () => {
    render(<InvoiceEditorPage initial={data()} backHref="/back" />);
    const bar = totalBar();
    expect(within(bar).getByText("$110.00")).toBeInTheDocument();
    expect(within(bar).getByText(/Subtotal \$100\.00 · GST \$10\.00/)).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Review" }));
    expect(patches()).toHaveLength(0);
    await act(async () => { fireEvent.click(within(totalBar()).getByRole("button", { name: "Approve" })); });
    await waitFor(() => expect(patches()).toEqual([{ status: "APPROVED" }]));
    // The header's primary button is hidden on a phone (CSS), not duplicated as a second action.
    const headerApprove = screen.getAllByRole("button", { name: "Approve" }).find((button) => !totalBar().contains(button));
    expect(headerApprove?.className).toContain("max-sm:hidden");
  });

  it("approved: the total bar's button is Send and opens the existing send dialog", () => {
    render(<InvoiceEditorPage initial={data({ row: { ...data().row, status: "APPROVED" }, editLock: { editable: false, kind: "issued", reason: "Approved." } as ClientInvoiceEditorData["editLock"] })} backHref="/back" />);
    fireEvent.click(within(totalBar()).getByRole("button", { name: "Send" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Send INV-0421");
    expect(calls.some((call) => call.url.includes("/send"))).toBe(false);
  });

  it("sent: the total bar follows the list's next step (Record payment)", () => {
    render(<InvoiceEditorPage initial={data({ row: { ...data().row, status: "SENT", sentAt: "2026-11-02T00:00:00.000Z" }, editLock: { editable: false, kind: "issued", reason: "Sent." } as ClientInvoiceEditorData["editLock"] })} backHref="/back" />);
    expect(within(totalBar()).getByRole("button", { name: "Record payment" })).toBeInTheDocument();
  });

  it("Move up / Move down in a line's menu save through the existing reorder save, within the property", async () => {
    render(<InvoiceEditorPage initial={data({ lines: mixed })} backHref="/back" />);
    fireEvent.click(screen.getByRole("button", { name: "Line actions for Turnover l3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ reorderLineIds: ["l2", "l3", "l1"] });
  });

  it("the first line in a section cannot move up", () => {
    render(<InvoiceEditorPage initial={data({ lines: mixed })} backHref="/back" />);
    fireEvent.click(screen.getByRole("button", { name: "Line actions for Turnover l1" }));
    expect(screen.getByRole("menuitem", { name: /Move up/ })).toHaveAttribute("aria-disabled", "true");
    expect(patches()).toHaveLength(0);
  });

  it("Add line sheet: the amount is worked out when saved, and Add line sends the existing addLine", async () => {
    render(<InvoiceEditorPage initial={data()} backHref="/back" />);
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    const sheet = screen.getByRole("dialog", { name: "Add a line" });
    expect(within(sheet).getByText("Worked out when saved")).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Description"), { target: { value: "Extra linen change" } });
    fireEvent.change(within(sheet).getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.change(within(sheet).getByLabelText("Rate"), { target: { value: "22" } });
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Add line" })); });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ addLine: { description: "Extra linen change", quantity: 2, unitPrice: 22 } });
  });

  it("offers the section switcher, the folded header facts with Edit, and every header action", () => {
    render(<InvoiceEditorPage initial={data()} backHref="/back" />);
    const nav = screen.getByRole("navigation", { name: "Invoice sections" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Lines", "Checks", "Send", "Xero", "History"]);
    expect(screen.getByRole("button", { name: "More actions for INV-0421" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preview PDF" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Invoice details" })).toBeInTheDocument();
  });

  it("from 640px up: the table, no total bar, no switcher, no line cards", () => {
    phoneMedia(false);
    render(<InvoiceEditorPage initial={data({ lines: mixed })} backHref="/back" />);
    expect(screen.queryByRole("region", { name: "Invoice total" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Invoice sections" })).toBeNull();
    expect(document.querySelector("[data-line-cards]")).toBeNull();
    expect(screen.getByRole("region", { name: "Invoice lines table" })).toBeInTheDocument();
    expect(screen.getAllByRole("list", { name: "Invoice stages" })).toHaveLength(1);
  });
});
