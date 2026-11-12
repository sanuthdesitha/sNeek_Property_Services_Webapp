/**
 * Pay → This period (approved cleaner board, 2026-11). Plain module.
 *
 * Every figure comes from `getCleanerInvoiceData` (the same rail the invoice
 * uses). The lines only regroup the server's own totals: the job rows are the
 * server's per-job amounts, and the lines add up to the server's
 * `estimatedPay`. A line with no money is left out rather than shown as $0.
 */
import type { CleanerInvoiceData } from "@/lib/cleaner/invoice";

export interface PayLine {
  key: string;
  label: string;
  amount: number;
}

type PeriodTotals = Pick<
  CleanerInvoiceData,
  "rows" | "shoppingTimeRows" | "shoppingTimeTotal" | "expenseTotal" | "extraLineTotal" | "qaInspectionTotal" | "transportAllowanceTotal"
>;

function hoursLabel(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} h`;
}

export function payPeriodLines(data: PeriodTotals): PayLine[] {
  const jobsTotal = data.rows.reduce((sum, row) => sum + row.amount, 0);
  const shoppingMinutes = data.shoppingTimeRows.reduce((sum, row) => sum + row.minutes, 0);
  const lines: PayLine[] = [
    { key: "jobs", label: "Cleaning jobs", amount: jobsTotal },
    { key: "shopping-time", label: shoppingMinutes > 0 ? `Shopping time, ${hoursLabel(shoppingMinutes)}` : "Shopping time", amount: data.shoppingTimeTotal },
    { key: "reimbursements", label: "Reimbursements", amount: data.expenseTotal },
    { key: "extra", label: "Extra pay approved", amount: data.extraLineTotal },
    { key: "qa", label: "QA inspections", amount: data.qaInspectionTotal },
    { key: "transport", label: "Transport allowances", amount: data.transportAllowanceTotal },
  ];
  return lines.filter((line) => line.key === "jobs" || line.amount !== 0);
}

/** How a job's status reads on the pay list (a recorded fact, not a promise of payment). */
export function payJobStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "SUBMITTED":
      return "Submitted";
    case "QA_REVIEW":
      return "Waiting for QA";
    case "COMPLETED":
      return "Completed";
    case "INVOICED":
      return "Invoiced";
    case null:
    case undefined:
      return "Status unknown";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
  }
}

export type PayTabKey = "period" | "invoices" | "requests";

export function resolvePayTab(value: string | undefined): PayTabKey {
  return value === "invoices" || value === "requests" ? value : "period";
}
