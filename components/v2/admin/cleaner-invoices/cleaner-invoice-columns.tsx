"use client";

/**
 * Columns for the cleaner-invoice table and the one-action-plus-menu cell.
 * Sorting is on real columns only (the payee name is not one).
 */
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { CleanerInvoiceSort } from "@/lib/cleaner/invoice-admin-list-types";
import {
  ACTION_LABEL,
  CORRECTION_ACTIONS,
  PRIMARY_LABEL,
  STATUS_LABEL,
  STATUS_PILL,
  cleanerRowActions,
  fmtDay,
  fmtStamp,
  money,
  type CleanerRow,
  type CleanerUiAction,
} from "./cleaner-invoice-model";

export const cleanerReviewHref = (id: string, back?: string) =>
  `/v2/admin/finance/cleaner-invoices/${id}${back ? `?back=${encodeURIComponent(back)}` : ""}`;
export const cleanerPdfHref = (id: string) => `/api/admin/cleaner-invoices/${id}/pdf?inline=1`;

export function CleanerRowActions({
  row,
  role,
  busy,
  disabled,
  reviewHref,
  onAction,
}: {
  row: CleanerRow;
  role: string;
  busy: boolean;
  disabled: boolean;
  reviewHref: string;
  onAction: (action: CleanerUiAction, row: CleanerRow) => void;
}) {
  const { primary, menu } = cleanerRowActions(row, role);
  const label = row.invoiceNumber ?? `${row.cleanerName}'s invoice`;
  let separated = false;
  const items: ERowMenuItem[] = menu.map((action) => {
    const correction = CORRECTION_ACTIONS.has(action);
    const item: ERowMenuItem = {
      key: action,
      label: ACTION_LABEL[action],
      danger: action === "delete" || action === "reverse",
      separated: correction && !separated,
      ...(action === "view" ? { href: reviewHref } : action === "pdf" ? { href: cleanerPdfHref(row.id), newTab: true } : { onSelect: () => onAction(action, row) }),
    };
    if (correction) separated = true;
    return item;
  });
  const opensPage = primary === "review" || primary === "review-payment" || primary === "view";
  return (
    <div className="flex items-center justify-end gap-1">
      {opensPage ? (
        <EButton asChild size="sm" variant={primary === "view" ? "outline" : "primary"}>
          <Link href={reviewHref} aria-label={`${PRIMARY_LABEL[primary]} ${label}`}>{PRIMARY_LABEL[primary]}</Link>
        </EButton>
      ) : (
        <EButton size="sm" variant="outline" disabled={busy || disabled} onClick={() => onAction(primary as CleanerUiAction, row)} aria-label={`${PRIMARY_LABEL[primary]} ${label}`}>
          {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
          {PRIMARY_LABEL[primary]}
        </EButton>
      )}
      <ERowMenu label={`More actions for ${label}`} items={items} disabled={busy || disabled} />
    </div>
  );
}

export function cleanerColumns(input: {
  reviewHref: (row: CleanerRow) => string;
  renderActions: (row: CleanerRow) => React.ReactNode;
}): Array<EDataColumn<CleanerRow, CleanerInvoiceSort>> {
  return [
    {
      key: "number",
      header: "Invoice",
      sortKey: "number",
      cell: (row) =>
        row.invoiceNumber ? (
          <Link href={input.reviewHref(row)} className="font-mono text-[0.75rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            {row.invoiceNumber}
          </Link>
        ) : (
          // These really have no number: they were sent before the sequence existed.
          <Link href={input.reviewHref(row)} className="text-[0.75rem] text-[hsl(var(--e-text-faint))] underline-offset-2 hover:underline">Not numbered</Link>
        ),
    },
    {
      key: "cleaner",
      header: "Cleaner",
      cell: (row) => (
        <span className="block max-w-[14rem] truncate font-[550]">
          {row.cleanerName}
          {row.cleanerRole === "QA_INSPECTOR" ? <span className="ml-2 text-[0.6875rem] font-normal uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">QA inspector</span> : null}
        </span>
      ),
    },
    { key: "period", header: "Period", sortKey: "period", cell: (row) => <span className="whitespace-nowrap text-[0.75rem]">{fmtDay(row.periodStart)} – {fmtDay(row.periodEnd)}</span> },
    { key: "submitted", header: "Submitted", sortKey: "submitted", firstDir: "desc", cell: (row) => <span className="whitespace-nowrap text-[0.75rem]">{fmtDay(row.createdAt)}</span> },
    { key: "jobs", header: "Jobs", sortKey: "jobs", align: "right", cell: (row) => <span className="e-tnum">{row.jobCount}</span> },
    { key: "hours", header: "Hours", sortKey: "hours", align: "right", cell: (row) => <span className="e-tnum">{Number(row.hours || 0).toFixed(2)}</span> },
    { key: "total", header: "Amount", sortKey: "total", align: "right", firstDir: "desc", cell: (row) => <span className="e-tnum">{money(row.totalAmount)}</span> },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      cell: (row) => (
        <span className="inline-flex max-w-[16rem] flex-col items-start gap-0.5">
          <EPill tone={STATUS_PILL[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</EPill>
          {row.status === "CHANGES_REQUESTED" ? (
            <span className="text-[0.6875rem] leading-tight text-[hsl(var(--e-text-secondary))]">
              Sent back {fmtStamp(row.changesRequestedAt)}: {row.changesRequestedNote ? `“${row.changesRequestedNote}”` : "no reason recorded."}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-[200px]", cell: input.renderActions },
  ];
}
