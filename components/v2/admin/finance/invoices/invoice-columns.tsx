"use client";

/**
 * Table columns for the client-invoice list, in the concept's order:
 * Invoice, Client, Period, Due, Total, Owing, Status, Xero, action + menu.
 */
import { format } from "date-fns";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { ClientInvoiceSort } from "@/lib/billing/client-invoice-list-types";
import { STATUS_LABEL, fmtDate, fmtDay, money, type InvoiceRow, type InvoiceStatus } from "./invoice-model";

const STATUS_PILL: Record<InvoiceStatus, EPillTone> = {
  DRAFT: "neutral",
  APPROVED: "info",
  SENT: "gold",
  PART_PAID: "warn",
  PAID: "ok",
  VOID: "neutral",
};

/** "1–15 Oct" within a month, "28 Sep – 4 Oct" across months. */
export function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "—";
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return `${format(from, "d")}–${format(to, "d MMM")}`;
  }
  return `${format(from, "d MMM")} – ${format(to, "d MMM")}`;
}

/** Whole days from `today` to `day`, both yyyy-MM-dd calendar days. */
export function daysBetween(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function DueCell({ invoice, today, termsDays }: { invoice: InvoiceRow; today: string; termsDays: number }) {
  if (invoice.status === "VOID") return <span className="text-[hsl(var(--e-muted-foreground))]">—</span>;
  if (invoice.status === "PAID") {
    return <span className="text-[hsl(var(--e-muted-foreground))]">Paid {fmtDate(invoice.paidDate ?? invoice.paidAt)}</span>;
  }
  if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
    // Not sent yet: the PDF already prints this day (created + terms).
    return (
      <span className="e-tnum text-[hsl(var(--e-muted-foreground))]" title={`Printed on the PDF: created + ${termsDays} days`}>
        {fmtDay(invoice.dueDate)}
      </span>
    );
  }
  const days = daysBetween(today, invoice.dueDate);
  if (invoice.overdue || days < 0) {
    return <span className="e-tnum font-[600] text-[hsl(var(--e-danger))]">{Math.abs(days)} d overdue</span>;
  }
  return <span className="e-tnum">{days === 0 ? "Due today" : `In ${days} day${days === 1 ? "" : "s"}`}</span>;
}

function XeroCell({ invoice }: { invoice: InvoiceRow }) {
  if (invoice.xeroState === "PUSHED") return <EPill tone="ok">In Xero</EPill>;
  if (invoice.xeroState === "PENDING") return <EPill tone="bad">Pending or failed</EPill>;
  return <span className="text-[hsl(var(--e-muted-foreground))]">Not in Xero</span>;
}

export function invoiceColumns(input: {
  today: string;
  termsDays: number;
  renderActions: (invoice: InvoiceRow) => React.ReactNode;
}): Array<EDataColumn<InvoiceRow, ClientInvoiceSort>> {
  return [
    {
      key: "number",
      header: "Invoice",
      sortKey: "number",
      cell: (row) => <span className="font-mono text-[0.75rem] text-[hsl(var(--e-foreground))]">{row.invoiceNumber}</span>,
    },
    {
      key: "client",
      header: "Client",
      sortKey: "client",
      cell: (row) => <span className="block max-w-[14rem] truncate">{row.client.name}</span>,
    },
    {
      key: "period",
      header: "Period",
      sortKey: "period",
      cell: (row) => <span className="whitespace-nowrap">{formatPeriod(row.periodStart, row.periodEnd)}</span>,
    },
    {
      // The due day is created + payment terms, so it sorts by created date.
      key: "due",
      header: "Due",
      sortKey: "created",
      firstDir: "asc",
      cell: (row) => <DueCell invoice={row} today={input.today} termsDays={input.termsDays} />,
    },
    {
      key: "total",
      header: "Total",
      sortKey: "total",
      align: "right",
      firstDir: "desc",
      cell: (row) => <span className="e-tnum">{money(row.totalAmount)}</span>,
    },
    {
      key: "owing",
      header: "Owing",
      align: "right",
      cell: (row) => <span className="e-tnum">{row.status === "VOID" ? "—" : money(row.amountOwing)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      cell: (row) => (
        <span className="inline-flex flex-wrap gap-1">
          <EPill tone={STATUS_PILL[row.status]}>{STATUS_LABEL[row.status]}</EPill>
          {row.overdue ? <EPill tone="bad">Overdue</EPill> : null}
        </span>
      ),
    },
    { key: "xero", header: "Xero", sortKey: "xero", cell: (row) => <XeroCell invoice={row} /> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-[190px]", cell: input.renderActions },
  ];
}
