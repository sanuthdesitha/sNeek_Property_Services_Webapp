import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => null }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { InvoiceEditorPage, saveStateLabel } from "@/components/v2/admin/finance/invoices/editor/invoice-editor-page";
import { InvoiceRowActions } from "@/components/v2/admin/finance/invoices/invoice-row-actions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("InvoiceEditorPage", () => {
  let calls: Call[];
  let patchResponses: Array<() => Promise<Response>>;
  beforeEach(() => {
    calls = [];
    patchResponses = [];
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PATCH") return (patchResponses.shift() ?? (() => Promise.resolve(new Response("{}"))))();
      return Promise.resolve(new Response(JSON.stringify(data())));
    }));
  });

  it("renders one h1 with the status, the stage bar and the design's sections", () => {
    render(<InvoiceEditorPage initial={data()} backHref="/v2/admin/finance?tab=invoices&status=SENT" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("INV-0421");
    expect(screen.getByRole("link", { name: "← Client invoices" })).toHaveAttribute("href", "/v2/admin/finance?tab=invoices&status=SENT");
    expect(screen.getByRole("list", { name: "Invoice stages" })).toHaveTextContent("1 Draft");
    expect(screen.getByText("Before you approve")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "J-1009" })).toHaveAttribute("href", "/v2/admin/jobs/j1");
  });

  it("leads with the list's primary action (Approve on a draft) and keeps the rest in the menu", () => {
    render(<InvoiceEditorPage initial={data()} backHref="/back" />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for INV-0421" }));
    expect(screen.getByRole("menuitem", { name: "Download PDF" })).toHaveAttribute("href", "/api/admin/invoices/inv/pdf");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit/i })).toBeNull();
  });

  it("keeps a refused save on screen with the server's message and retries the same request", async () => {
    let release!: (response: Response) => void;
    patchResponses.push(() => new Promise<Response>((resolve) => (release = resolve)));
    patchResponses.push(() => Promise.resolve(new Response("{}")));
    render(<InvoiceEditorPage initial={data()} backHref="/back" />);
    const description = screen.getByRole("textbox", { name: "Description of Airbnb turnover" });
    fireEvent.change(description, { target: { value: "Airbnb turnover + linen" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    // Frozen while the save runs.
    expect(screen.getByRole("textbox", { name: "Description of Airbnb turnover" })).toBeDisabled();
    await act(async () => {
      release(new Response(JSON.stringify({ error: "This invoice is in Xero. Reconcile a correction there before altering the issued document." }), { status: 409 }));
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This invoice is in Xero.");
    expect(screen.getByRole("textbox", { name: "Description of Airbnb turnover" })).toHaveValue("Airbnb turnover + linen");
    expect(screen.getByRole("textbox", { name: "Description of Airbnb turnover" })).not.toBeDisabled();

    const firstBody = calls.find((call) => call.init?.method === "PATCH")?.init?.body;
    // Wave D: every PATCH carries the version the page read (stale-write guard).
    expect(JSON.parse(String(firstBody))).toEqual({ updateLines: [{ id: "l1", description: "Airbnb turnover + linen", quantity: 1, unitPrice: 100 }], expectedUpdatedAt: "2026-11-11T01:00:00.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(2));
    expect(calls.filter((call) => call.init?.method === "PATCH")[1].init?.body).toBe(firstBody);
  });

  it("does not resend an added line after a lost response; it reloads instead", async () => {
    patchResponses.push(() => Promise.reject(new TypeError("network down")));
    render(<InvoiceEditorPage initial={data()} backHref="/back" />);
    fireEvent.change(screen.getByRole("combobox", { name: "New line description" }), { target: { value: "Key cut" } });
    fireEvent.change(screen.getByRole("textbox", { name: "New line rate" }), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("may or may not have been saved");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await waitFor(() => expect(calls.some((call) => call.url.includes("view=editor"))).toBe(true));
    expect(screen.getByRole("combobox", { name: "New line description" })).toHaveValue("Key cut");
  });

  it("presents an invoice that can no longer be edited read-only, with the reason", () => {
    const sent = data({
      row: { ...data().row, status: "PAID", paidAt: "2026-11-05T00:00:00.000Z", paidAmount: 110, amountOwing: 0, sentAt: "2026-11-02T00:00:00.000Z" },
      editLock: { editable: false, kind: "payment", reason: "This invoice has payment evidence. Use a reconciled correction; its payment history cannot be cleared." },
    });
    render(<InvoiceEditorPage initial={sent} backHref="/back" />);
    expect(screen.getByText(/Read only\./).parentElement).toHaveTextContent("payment evidence");
    expect(screen.queryByRole("textbox", { name: /Description of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save draft/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reorder/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Payment record" })).toBeInTheDocument();
  });

  it("shows a void invoice's stage as Void instead of the five steps", () => {
    render(<InvoiceEditorPage initial={data({ row: { ...data().row, status: "VOID" }, editLock: { editable: false, kind: "void", reason: "Void." } })} backHref="/back" />);
    expect(screen.queryByRole("list", { name: "Invoice stages" })).toBeNull();
    expect(screen.getByRole("group", { name: "Invoice stages" })).toHaveTextContent("Void");
  });
});

describe("parity restorations (audit 2026-11-12)", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PATCH") return Promise.resolve(new Response("{}"));
      return Promise.resolve(new Response(JSON.stringify(data())));
    }));
  });

  const line = (id: string, property: string) => ({
    ...data().lines[0],
    id,
    description: `Turnover ${id}`,
    job: { id: `j-${id}`, jobNumber: `J-${id}`, scheduledDay: "2026-10-18", property: { id: null, name: property, suburb: null } },
  });
  const mixed = [line("l1", "The Bondi Studio"), line("l2", "Albion Loft"), line("l3", "The Bondi Studio")];
  const patches = () => calls.filter((call) => call.init?.method === "PATCH").map((call) => JSON.parse(String(call.init?.body)));

  it("Mark as sent (not emailed) confirms that no email is sent, then PATCHes the status only", async () => {
    render(<InvoiceEditorPage initial={data({ row: { ...data().row, status: "APPROVED" } })} backHref="/back" />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for INV-0421" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as sent (not emailed)" }));
    expect(screen.getByText(/No email is sent\./)).toBeInTheDocument();
    expect(patches()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(patches()).toEqual([{ status: "SENT" }]));
    expect(calls.some((call) => call.url.includes("/send"))).toBe(false);
  });

  it("Group by property saves the grouped line order on an editable invoice", async () => {
    render(<InvoiceEditorPage initial={data({ lines: mixed })} backHref="/back" />);
    const toggle = screen.getByRole("button", { name: "Group by property" });
    // Several properties: the view starts grouped (as the PDF prints). Off is view only.
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(patches()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Group by property" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ reorderLineIds: ["l2", "l1", "l3"] });
  });

  it("Group by property only changes the view on a read-only invoice", () => {
    const locked = data({
      lines: mixed,
      row: { ...data().row, status: "SENT", sentAt: "2026-11-02T00:00:00.000Z" },
      editLock: { editable: false, kind: "issued", reason: "Sent invoices are corrected by a credit note." },
    });
    render(<InvoiceEditorPage initial={locked} backHref="/back" />);
    fireEvent.click(screen.getByRole("button", { name: "Group by property" }));
    fireEvent.click(screen.getByRole("button", { name: "Group by property" }));
    expect(patches()).toHaveLength(0);
  });
});

describe("save state words", () => {
  it("separates saving, failed, unsaved and saved", () => {
    const at = "2026-11-11T01:00:00.000Z";
    expect(saveStateLabel({ kind: "saving", what: "x" }, false, at, "Australia/Sydney")).toBe("Saving…");
    expect(saveStateLabel({ kind: "failed", what: "x", message: "m", retry: null }, true, at, "Australia/Sydney")).toBe("Not saved");
    expect(saveStateLabel({ kind: "idle" }, true, at, "Australia/Sydney")).toBe("Unsaved changes");
    expect(saveStateLabel({ kind: "idle" }, false, at, "Australia/Sydney")).toBe("Last changed 11 Nov, 12:00");
  });
});

describe("list rows open the editor page", () => {
  it("renders Review as a link to the editor", () => {
    const row = data().row;
    render(<InvoiceRowActions invoice={row} busy={false} disabled={false} editHref="/v2/admin/finance/invoices/inv?back=status%3DDRAFT" onAction={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Review INV-0421" })).toHaveAttribute("href", "/v2/admin/finance/invoices/inv?back=status%3DDRAFT");
  });
});
