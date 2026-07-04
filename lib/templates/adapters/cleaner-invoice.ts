/**
 * Adapter: CleanerInvoiceData → the doc.cleanerInvoice (RCTI) contract
 * (rebrand doc 03 §4.2). CleanerInvoiceData is already fully assembled by
 * lib/cleaner/invoice.ts getCleanerInvoiceData (no db / no S3), so this is a
 * pure mapping. Money passes as RAW NUMBERS; the template formats. The grand
 * total mirrors the legacy components (pay + reimbursements + shopping time +
 * extras) — no independent money math.
 */

import type { CleanerInvoiceData } from "@/lib/cleaner/invoice";

export interface CleanerInvoiceContractData {
  cleaner: {
    name: string;
    abn: string;
    email: string;
    phone: string;
    address: string;
    bankName: string;
    bsb: string;
    accountNumber: string;
    accountName: string;
  };
  invoice: { number: string; periodStart: Date; periodEnd: Date };
  summary: { jobs: number; hours: number; gross: number };
  lines: Array<{ date: string; description: string; property: string; amount: number }>;
  expenses: Array<{ date: string; description: string; amount: number }>;
  shoppingTime: Array<{ date: string; description: string; amount: number }>;
  extras: Array<{ date: string; description: string; amount: number }>;
  totals: {
    estimatedPay: number;
    expenses: number;
    shoppingTime: number;
    extras: number;
    grandTotal: number;
  };
  hasExpenses: boolean;
  hasShoppingTime: boolean;
  hasExtras: boolean;
  pending: { count: number; amount: number; hasPending: boolean };
  actionUrl: string;
}

function ymd(d: Date): string {
  return new Date(d).toISOString().slice(0, 10).replace(/-/g, "");
}

export function toCleanerInvoiceContractData(
  data: CleanerInvoiceData,
  actionUrl?: string | null,
): CleanerInvoiceContractData {
  const grandTotal =
    Number(data.estimatedPay ?? 0) +
    Number(data.expenseTotal ?? 0) +
    Number(data.shoppingTimeTotal ?? 0) +
    Number(data.extraLineTotal ?? 0);

  return {
    cleaner: {
      name: data.cleanerName ?? "",
      abn: data.cleanerAbn ?? "",
      email: data.cleanerEmail ?? "",
      phone: data.cleanerPhone ?? "",
      address: data.cleanerAddress ?? "",
      bankName: data.cleanerBankName ?? "",
      bsb: data.cleanerBankBsb ?? "",
      accountNumber: data.cleanerBankAccountNumber ?? "",
      accountName: data.cleanerBankAccountName ?? "",
    },
    invoice: {
      number: `INV-${ymd(data.start)}-${ymd(data.end)}`,
      periodStart: new Date(data.start),
      periodEnd: new Date(data.end),
    },
    summary: {
      jobs: data.rows.length,
      hours: Number(data.hours ?? 0),
      gross: grandTotal,
    },
    lines: data.rows.map((r) => ({
      date: r.date,
      description: [r.jobName, r.jobType].filter(Boolean).join(" · "),
      property: r.property,
      amount: Number(r.amount ?? 0),
    })),
    expenses: data.expenseRows.map((e) => ({
      date: e.date,
      description: [e.runName, e.properties].filter(Boolean).join(" · "),
      amount: Number(e.amount ?? 0),
    })),
    shoppingTime: data.shoppingTimeRows.map((s) => ({
      date: s.date,
      description: [s.runName, s.properties].filter(Boolean).join(" · "),
      amount: Number(s.amount ?? 0),
    })),
    extras: data.extraLineRows.map((x) => ({
      date: x.date,
      description: x.description,
      amount: Number(x.amount ?? 0),
    })),
    totals: {
      estimatedPay: Number(data.estimatedPay ?? 0),
      expenses: Number(data.expenseTotal ?? 0),
      shoppingTime: Number(data.shoppingTimeTotal ?? 0),
      extras: Number(data.extraLineTotal ?? 0),
      grandTotal,
    },
    hasExpenses: data.expenseRows.length > 0,
    hasShoppingTime: data.shoppingTimeRows.length > 0,
    hasExtras: data.extraLineRows.length > 0,
    pending: {
      count: Number(data.pendingAdjustmentCount ?? 0),
      amount: Number(data.pendingAdjustmentAmount ?? 0),
      hasPending: Number(data.pendingAdjustmentCount ?? 0) > 0,
    },
    actionUrl: actionUrl ?? "",
  };
}
