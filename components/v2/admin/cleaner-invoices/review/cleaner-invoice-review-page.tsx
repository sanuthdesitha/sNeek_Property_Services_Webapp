"use client";

/**
 * The cleaner invoice review page: header with the one primary action and a
 * menu of every other action this role may take, the stage bar, the lines and
 * notes, the comparison and the history. Read-only: nothing on the invoice is
 * edited here. After an action the server data is re-read.
 */
import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import { availableCleanerInvoiceActions } from "@/lib/cleaner/invoice-transitions";
import { ACTION_LABEL, CORRECTION_ACTIONS, STATUS_LABEL, STATUS_PILL, fmtDay, money, type CleanerUiAction } from "../cleaner-invoice-model";
import { cleanerPdfHref } from "../cleaner-invoice-columns";
import { CleanerInvoiceDialogs } from "../cleaner-invoice-dialogs";
import { useCleanerInvoiceActions } from "../use-cleaner-invoice-actions";
import { ComparisonCard, HistoryCard, LinesCard, NotesCard } from "./cleaner-invoice-review-sections";

/** The page leads with the next step; Approve first for an administrator. */
const PRIMARY_ORDER: CleanerUiAction[] = ["approve", "review-delivery", "record-payment", "push-xero"];

export function CleanerInvoiceReviewPage({ review, role, backHref }: { review: CleanerInvoiceReview; role: string; backHref: string }) {
  const router = useRouter();
  const { row } = review;
  const refresh = useCallback(() => router.refresh(), [router]);
  const { busyId, dialog, setDialog, onAction } = useCleanerInvoiceActions(refresh, () => `/v2/admin/finance/cleaner-invoices/${row.id}`);
  const actions = availableCleanerInvoiceActions(row, role);
  const primary = PRIMARY_ORDER.find((action) => actions.includes(action as never)) ?? null;
  let separated = false;
  const items: ERowMenuItem[] = actions
    .filter((action) => action !== primary)
    .map((action) => {
      const correction = CORRECTION_ACTIONS.has(action);
      const item: ERowMenuItem = { key: action, label: ACTION_LABEL[action], danger: action === "delete" || action === "reverse", separated: correction && !separated, onSelect: () => onAction(action, row) };
      if (correction) separated = true;
      return item;
    });
  const title = `${row.invoiceNumber ?? "Invoice (not numbered)"} · ${row.cleanerName}`;
  const busy = busyId === row.id || Boolean(dialog);

  return (
    <div className="space-y-5">
      <Link href={backHref} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Cleaner invoices</Link>
      <EPageHeader
        eyebrow={row.cleanerRole === "QA_INSPECTOR" ? "QA inspector invoice" : "Cleaner invoice"}
        title={title}
        description={`${fmtDay(row.periodStart)} – ${fmtDay(row.periodEnd)} · ${row.jobCount} jobs · ${Number(row.hours || 0).toFixed(2)} h · ${money(row.totalAmount)} · submitted ${fmtDay(row.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <EPill tone={STATUS_PILL[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</EPill>
            <EButton asChild size="sm" variant="outline">
              <a href={cleanerPdfHref(row.id)} target="_blank" rel="noreferrer">PDF</a>
            </EButton>
            {primary ? (
              <EButton size="sm" variant="primary" disabled={busy} onClick={() => onAction(primary, row)}>{ACTION_LABEL[primary]}</EButton>
            ) : null}
            {items.length ? <ERowMenu label={`More actions for ${title}`} items={items} disabled={busy} /> : null}
          </div>
        }
      />
      <EStageBar label="Cleaner invoice stages" stages={review.stages.stages} terminal={review.stages.terminal} />
      {role !== "ADMIN" && row.status === "SUBMITTED" ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Only an administrator can approve cleaner invoices.</p>
      ) : null}
      {row.xeroBillId ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">In Xero as draft bill {row.xeroBillId.slice(0, 8)}…</p> : null}
      <div className="flex min-w-0 flex-col gap-3.5 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-3.5">
          <NotesCard row={row} />
          <LinesCard row={row} />
        </div>
        <aside aria-label="Comparison and history" className="flex min-w-0 flex-col gap-3.5 xl:w-[360px] xl:flex-none">
          <ComparisonCard comparison={review.comparison} />
          <HistoryCard history={review.history} />
        </aside>
      </div>
      <CleanerInvoiceDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onDone={() => (dialog?.kind === "delete" ? router.push(backHref) : refresh())}
      />
    </div>
  );
}
