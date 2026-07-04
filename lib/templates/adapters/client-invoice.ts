/**
 * Adapter: ClientInvoice (with lines/client) → the `doc.clientInvoice` /
 * `email.clientInvoiceIssued` data contract (rebrand doc 03 §1.5, §5.2).
 *
 * This is the ONLY sender-side change the invoice needs — structured data in,
 * matching the kind's zod contract. Money is passed as RAW NUMBERS; the
 * template formats via {{ | money}}. Never recompute totals here.
 */

import { addDays } from "date-fns";
import type { getClientInvoice } from "@/lib/billing/client-invoices";

type Invoice = NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>;

export interface InvoiceContractData {
  invoice: {
    number: string;
    issuedAt: Date;
    dueAt: Date;
    periodStart: Date | null;
    periodEnd: Date | null;
    subtotal: number;
    gstAmount: number;
    totalAmount: number;
    gstEnabled: boolean;
    lines: Array<{
      description: string;
      propertyName: string;
      quantity: number;
      unitAmount: number;
      lineTotal: number;
      meta: string;
    }>;
  };
  client: { name: string; email: string };
  payment: {
    bankName: string;
    bsb: string;
    accountNumber: string;
    accountName: string;
    note: string;
    payUrl: string;
  };
  actionUrl: string;
}

export interface InvoiceAdapterOptions {
  bankName?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  paymentNote?: string | null;
  defaultPaymentTermsDays?: number | null;
  /** Portal deep link for the "View & pay" CTA. */
  actionUrl?: string | null;
  payUrl?: string | null;
}

export function toInvoiceContractData(
  invoice: Invoice,
  opts: InvoiceAdapterOptions = {},
): InvoiceContractData {
  const termsDays = opts.defaultPaymentTermsDays ?? 14;
  const issuedAt = new Date(invoice.createdAt);
  const subtotal = Number(invoice.subtotal ?? 0);
  const gstAmount = Number(invoice.gstAmount ?? 0);

  return {
    invoice: {
      number: invoice.invoiceNumber,
      issuedAt,
      dueAt: addDays(issuedAt, termsDays),
      periodStart: invoice.periodStart ? new Date(invoice.periodStart) : null,
      periodEnd: invoice.periodEnd ? new Date(invoice.periodEnd) : null,
      subtotal,
      gstAmount,
      totalAmount: Number(invoice.totalAmount ?? 0),
      // Explicit flag drives the totals `when`; derive from the stored amount so
      // a $0-GST invoice with GST disabled hides the row.
      gstEnabled: gstAmount > 0,
      lines: invoice.lines.map((line) => ({
        description: line.description,
        propertyName: line.job?.property?.name ?? "",
        quantity: Number(line.quantity ?? 0),
        unitAmount: Number(line.unitPrice ?? 0),
        lineTotal: Number(line.lineTotal ?? 0),
        meta: line.job
          ? [line.job.property?.name, line.job.jobNumber || line.job.id]
              .filter(Boolean)
              .join(" · ")
          : "",
      })),
    },
    client: {
      name: invoice.client?.name ?? "",
      email: invoice.client?.email ?? "",
    },
    payment: {
      bankName: opts.bankName ?? "",
      bsb: opts.bankBsb ?? "",
      accountNumber: opts.bankAccountNumber ?? "",
      accountName: opts.bankAccountName ?? "",
      note: opts.paymentNote ?? "",
      payUrl: opts.payUrl ?? "",
    },
    actionUrl: opts.actionUrl ?? "",
  };
}
