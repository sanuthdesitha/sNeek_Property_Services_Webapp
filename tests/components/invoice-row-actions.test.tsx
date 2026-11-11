import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availableInvoiceActions,
  invoiceActionLabel,
  invoiceRowActions,
  primaryInvoiceAction,
  type InvoiceRow,
} from "@/components/v2/admin/finance/invoices/invoice-model";
import { InvoiceRowActions } from "@/components/v2/admin/finance/invoices/invoice-row-actions";

afterEach(cleanup);

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv", invoiceNumber: "INV-1", status: "DRAFT", totalAmount: 100, paidAmount: null, amountOwing: 100,
    periodStart: null, periodEnd: null, sentAt: null, paidAt: null, paidDate: null, paymentMethod: null, paymentReference: null,
    createdAt: "2026-11-01T00:00:00Z", dueDate: "2026-11-15", overdue: false, xeroInvoiceId: null, xeroExportedAt: null,
    xeroState: "NONE", client: { id: "c", name: "Client", email: null }, ...overrides,
  };
}

describe("one primary action per row", () => {
  it.each([
    [{ status: "DRAFT" }, "edit", "Review"],
    [{ status: "APPROVED" }, "send", "Send"],
    [{ status: "SENT" }, "record-payment", "Record payment"],
    [{ status: "SENT", overdue: true }, "resend", "Send reminder"],
    [{ status: "PART_PAID" }, "record-payment", "Record payment"],
    [{ status: "PART_PAID", xeroState: "PENDING" }, "xero-retry", "Retry Xero"],
    [{ status: "PAID", paidAt: "2026-11-02T00:00:00Z" }, "receipt", "Payment record"],
    [{ status: "VOID" }, "pdf", "View PDF"],
  ] as const)("%o → %s", (overrides, key, label) => {
    const invoice = row(overrides as Partial<InvoiceRow>);
    expect(primaryInvoiceAction(invoice)).toBe(key);
    expect(invoiceActionLabel(key, invoice)).toBe(label);
    const { primary, secondary } = invoiceRowActions(invoice);
    expect(secondary).not.toContain(primary);
    expect([primary, ...secondary].sort()).toEqual(availableInvoiceActions(invoice).sort());
  });

  it("keeps every existing action reachable under the old conditions", () => {
    expect(availableInvoiceActions(row())).toEqual(["edit", "pdf", "approve", "send", "record-payment", "mark-paid", "xero-push", "delete"]);
    expect(availableInvoiceActions(row({ status: "SENT" }))).toEqual(["pdf", "resend", "record-payment", "mark-paid", "xero-push", "void", "reverse"]);
    expect(availableInvoiceActions(row({ status: "SENT", xeroInvoiceId: "X", xeroState: "PUSHED" }))).toEqual(["pdf", "resend", "record-payment", "mark-paid", "xero-push", "reconcile"]);
    expect(availableInvoiceActions(row({ status: "PART_PAID", paidAmount: 20 }))).toEqual(["pdf", "resend", "record-payment", "mark-paid", "receipt", "xero-push"]);
    expect(availableInvoiceActions(row({ status: "VOID" }))).toEqual(["pdf"]);
  });

  it("renders the primary button and puts the rest in the menu, PDF as a link", () => {
    const onAction = vi.fn();
    render(<InvoiceRowActions invoice={row()} busy={false} disabled={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Review INV-1" }));
    expect(onAction).toHaveBeenCalledWith("edit", expect.objectContaining({ id: "inv" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for INV-1" }));
    expect(screen.getByRole("menuitem", { name: "View PDF" })).toHaveAttribute("href", "/api/admin/invoices/inv/pdf?inline=1");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onAction).toHaveBeenLastCalledWith("delete", expect.objectContaining({ id: "inv" }));
  });
});
