/**
 * The "Update in Xero" confirmation (2026-11-18): tier A by default, tier B
 * with both totals when the server says Xero's figures differ, Xero's refusal
 * shown in the dialog, one request key for every retry. fetch is mocked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

import { XeroUpdateDialog } from "@/components/v2/admin/finance/invoices/xero-update-dialog";
import { XeroCard } from "@/components/v2/admin/finance/invoices/editor/editor-panels";
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  toastMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const target = { id: "inv", invoiceNumber: "INV-7", kind: "INVOICE" };
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

describe("XeroUpdateDialog", () => {
  it("tier A: one sentence and Update in Xero; success closes and reports", async () => {
    fetchMock.mockReturnValue(reply(200, { ok: true, message: "Updated in Xero (line order only)." }));
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<XeroUpdateDialog target={target} onClose={onClose} onDone={onDone} />);
    expect(screen.getByRole("dialog", { name: "Update INV-7 in Xero?" })).toHaveTextContent("Amounts here are unchanged");
    fireEvent.click(screen.getByRole("button", { name: "Update in Xero" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/invoices/inv/xero-update");
    expect(bodies()[0]).toMatchObject({ confirmTotals: null });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Updated in Xero" }));
  });

  it("tier B with both totals when Xero differs, sending back the same two totals and the same key", async () => {
    fetchMock
      .mockReturnValueOnce(reply(409, { error: "differ", code: "XERO_UPDATE_NEEDS_CONFIRMATION", localTotal: 297, xeroTotal: 310 }))
      .mockReturnValueOnce(reply(200, { ok: true }));
    const onDone = vi.fn();
    render(<XeroUpdateDialog target={target} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Update in Xero" }));
    const dialog = await screen.findByRole("dialog", { name: "Overwrite INV-7 in Xero?" });
    expect(dialog).toHaveTextContent("Xero total $310.00; this invoice $297.00");
    expect(dialog).toHaveTextContent("This cannot be undone");
    fireEvent.click(screen.getByRole("button", { name: "Overwrite in Xero" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [first, second] = bodies();
    expect(second.confirmTotals).toEqual({ localTotal: 297, xeroTotal: 310 });
    expect(second.requestKey).toBe(first.requestKey);
  });

  it("shows Xero's refusal in the dialog and stays open; a retry keeps the key", async () => {
    fetchMock.mockReturnValue(reply(409, { error: "Xero shows this invoice as paid. Xero does not allow a paid invoice to be changed. Nothing was changed." }));
    const onClose = vi.fn();
    render(<XeroUpdateDialog target={target} onClose={onClose} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Update in Xero" }));
    expect(await screen.findByText(/Xero does not allow a paid invoice to be changed/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update in Xero" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies()[0].requestKey).toBe(bodies()[1].requestKey);
  });
});

function editorData(update: NonNullable<ClientInvoiceEditorData["xero"]["update"]>): ClientInvoiceEditorData {
  return {
    row: { id: "inv", invoiceNumber: "INV-7", status: "APPROVED", kind: "INVOICE", client: { id: "c", name: "Client", email: null }, xeroInvoiceId: "x", xeroState: "PUSHED", xeroSync: null } as unknown as ClientInvoiceEditorData["row"],
    timezone: "Australia/Sydney",
    xero: {
      state: "PUSHED", xeroInvoiceId: "x", exportedAt: "2026-11-01T00:00:00.000Z", contactId: "contact", salesAccountCode: "200", salesAccountName: "Sales",
      salesAccountNameReason: null, disbursementAccountCode: null, hasDisbursementLines: false, settingsError: null, update,
    },
  } as unknown as ClientInvoiceEditorData;
}

describe("Xero card", () => {
  it("offers Update in Xero on a pushed invoice and shows the last failure in words and Sydney time", () => {
    const onUpdate = vi.fn();
    render(<XeroCard data={editorData({ available: true, reason: null, inFlight: false, last: { state: "FAILED", key: "k", at: "2026-11-17T22:10:00.000Z", reason: "Xero API error (400): The period is locked", lastSuccessAt: null, change: null, xeroStatusBefore: "AUTHORISED" } })} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole("button", { name: "Update in Xero" }));
    expect(onUpdate).toHaveBeenCalled();
    expect(screen.getByText(/Last update failed 18 Nov 2026, 09:10: Xero API error \(400\): The period is locked/)).toBeInTheDocument();
  });

  it("says why it is not available", () => {
    render(<XeroCard data={editorData({ available: false, reason: "A payment is recorded on this invoice, and Xero does not allow an invoice with a payment to be changed.", inFlight: false, last: null })} onUpdate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Update in Xero" })).toBeNull();
    expect(screen.getByText(/Update in Xero is not available: A payment is recorded/)).toBeInTheDocument();
  });

  it("waits for unsaved edits and for an update already with Xero", () => {
    const { rerender } = render(<XeroCard data={editorData({ available: true, reason: null, inFlight: false, last: null })} onUpdate={vi.fn()} updateDisabledReason="Save your changes first." />);
    expect(screen.getByRole("button", { name: "Update in Xero" })).toBeDisabled();
    rerender(<XeroCard data={editorData({ available: true, reason: null, inFlight: true, last: null })} onUpdate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Update in Xero" })).toBeDisabled();
    expect(screen.getByText("An update is with Xero now.")).toBeInTheDocument();
  });
});
