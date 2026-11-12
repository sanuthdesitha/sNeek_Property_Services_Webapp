/**
 * Plain module (no "use client"): the server page reads these labels, and a
 * value exported from a client module cannot be read on the server.
 */
export type FinanceTabKey = "invoices" | "cleaner-invoices" | "payroll" | "adjustments" | "overview";

export const FINANCE_TAB_LABEL: Record<FinanceTabKey, string> = {
  invoices: "Client invoices",
  "cleaner-invoices": "Cleaner invoices",
  payroll: "Pay runs",
  adjustments: "Adjustments and time",
  overview: "Overview",
};
