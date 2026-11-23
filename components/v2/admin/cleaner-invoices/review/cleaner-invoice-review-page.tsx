"use client";

/**
 * The cleaner invoice review page (boards "Cleaner invoice" and "Pay run and
 * cleaner invoice, phone", 2026-11-17): heading with status, PDF, one primary
 * action and a menu of every other action this role may take (from the one
 * transition table, so nothing the server refuses is offered); the stage bar;
 * the pay-rule band; the lines as submitted; comparison, Xero and history.
 * Lines are changed only through "Amend this invoice" (2026-11-23), which keeps
 * the original and every amendment and tells the payee. After an action the
 * server data is re-read. On a phone the next step is docked and the page opens on
 * Lines, with Compare and History one tap away.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import type { CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import { availableCleanerInvoiceActions } from "@/lib/cleaner/invoice-transitions";
import { ACTION_LABEL, CORRECTION_ACTIONS, STATUS_LABEL, STATUS_PILL, fmtDay, money, type CleanerUiAction } from "../cleaner-invoice-model";
import { cleanerPdfHref } from "../cleaner-invoice-columns";
import { CleanerInvoiceDialogs } from "../cleaner-invoice-dialogs";
import { useCleanerInvoiceActions } from "../use-cleaner-invoice-actions";
import { ComparisonCard, HistoryCard, LinesCard, PayRuleBand, StatusNotice, XeroCard } from "./cleaner-invoice-review-sections";
import { AmendmentsCard, XeroOutOfDateNotice } from "./amendment-sections";
import { AmendInvoicePanel } from "./amend-invoice-panel";
import { JobDisclosure } from "@/components/v2/admin/jobs/detail/job-disclosure";

/** The page leads with the next step; Approve first for an administrator. */
const PRIMARY_ORDER: CleanerUiAction[] = ["approve", "review-delivery", "push-xero", "record-payment"];

const MENU_HINT: Partial<Record<CleanerUiAction, string>> = {
  "request-changes": "sends it back",
  reverse: "tier B",
  delete: "tier C, PIN",
};

type PhoneTab = "lines" | "compare" | "history";

function actionLabel(action: CleanerUiAction, status: string): string {
  if (action === "push-xero" && status === "XERO_EXPORTING") return "Retry push";
  return action === "approve" || action === "record-payment" || action === "request-changes" || action === "reverse" || action === "delete" || action === "reject-claim"
    ? `${ACTION_LABEL[action]}…`
    : ACTION_LABEL[action];
}

/** "Her pay request is paid at what she asked, $40.00." for the Approve confirmation. */
function approveNote(review: CleanerInvoiceReview): string | undefined {
  if ("error" in review.payRequests || !review.payRequests.length) return undefined;
  const amounts = review.payRequests.map((request) => (request.paidAmount === null ? "an amount that is not stored" : money(request.paidAmount)));
  return review.payRequests.length === 1
    ? `The pay request is paid at what was asked, ${amounts[0]}.`
    : `Each pay request is paid at what was asked: ${amounts.join(", ")}.`;
}

export function CleanerInvoiceReviewPage({ review, role, backHref, canManage = true }: { review: CleanerInvoiceReview; role: string; backHref: string; canManage?: boolean }) {
  const router = useRouter();
  const { row } = review;
  const [phoneTab, setPhoneTab] = React.useState<PhoneTab>("lines");
  const refresh = React.useCallback(() => router.refresh(), [router]);
  const { busyId, dialog, setDialog, onAction } = useCleanerInvoiceActions(refresh, () => `/v2/admin/finance/cleaner-invoices/${row.id}`);
  const actions = availableCleanerInvoiceActions(row, role);
  const primary = PRIMARY_ORDER.find((action) => actions.includes(action as never)) ?? null;
  const note = approveNote(review);
  const run = (action: CleanerUiAction) => (action === "approve" ? setDialog({ kind: "approve", row, note }) : onAction(action, row));
  let separated = false;
  const items: ERowMenuItem[] = actions
    .filter((action) => action !== primary)
    .map((action) => {
      const correction = CORRECTION_ACTIONS.has(action);
      const item: ERowMenuItem = {
        key: action,
        label: actionLabel(action, row.status),
        badge: MENU_HINT[action],
        danger: action === "delete" || action === "reverse",
        separated: correction && !separated,
        heading: correction && !separated ? "Corrections" : undefined,
        onSelect: () => run(action),
      };
      if (correction) separated = true;
      return item;
    });
  const title = `${row.invoiceNumber ?? "Invoice (not numbered)"} · ${row.cleanerName}`;
  const busy = busyId === row.id || Boolean(dialog);
  const menu = items.length ? (
    <ERowMenu label={`More actions for ${title}`} trigger="More" triggerVariant="outline" items={items} disabled={busy} footnote="Only actions the server allows for this status and your role are listed." />
  ) : null;
  const primaryButton = (className?: string) =>
    primary ? (
      <EButton size="sm" variant="primary" className={className} disabled={busy} onClick={() => run(primary)}>{actionLabel(primary, row.status)}</EButton>
    ) : null;
  const tabClass = (tab: PhoneTab) => (phoneTab === tab ? "" : "max-sm:hidden");

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Cleaner invoices</Link>
      <EPageHeader
        eyebrow={row.cleanerRole === "QA_INSPECTOR" ? "QA inspector invoice" : "Cleaner invoice"}
        title={
          <>
            {title}{" "}
            <EPill tone={STATUS_PILL[row.status] ?? "neutral"} className="align-middle font-sans text-[0.75rem]">{STATUS_LABEL[row.status] ?? row.status}</EPill>
          </>
        }
        description={`${fmtDay(row.periodStart)} – ${fmtDay(row.periodEnd)} · ${row.jobCount} jobs · ${Number(row.hours || 0).toFixed(2)} h · ${money(row.totalAmount)} · submitted ${fmtDay(row.createdAt)}`}
        actions={
          <>
            <EButton asChild size="sm" variant="outline">
              <a href={cleanerPdfHref(row.id)} target="_blank" rel="noreferrer">PDF</a>
            </EButton>
            {primaryButton("max-sm:hidden")}
            <span className="max-sm:hidden">{menu}</span>
          </>
        }
      />
      <EStageBar label="Cleaner invoice stages" stages={review.stages.stages} terminal={review.stages.terminal} />
      {role !== "ADMIN" && row.status === "SUBMITTED" ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Only an administrator can approve cleaner invoices.</p>
      ) : null}
      <StatusNotice review={review} />
      <XeroOutOfDateNotice review={review} readOnly={!canManage} />
      <div role="group" aria-label="Invoice sections" className="flex gap-1.5 sm:hidden">
        {(["lines", "compare", "history"] as PhoneTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={phoneTab === tab}
            onClick={() => setPhoneTab(tab)}
            className={cn(E_CHIP_CLASS, "flex-1 justify-center", phoneTab === tab && E_CHIP_ON_CLASS)}
          >
            {tab === "lines" ? "Lines" : tab === "compare" ? "Compare" : "History"}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-3.5 xl:flex-row">
        <div className={cn("min-w-0 flex-1 space-y-3.5", tabClass("lines"))}>
          <PayRuleBand review={review} />
          <AmendmentsCard review={review} />
          <LinesCard review={review} />
          {canManage ? (
            <JobDisclosure id="amend-invoice" label="Amend this invoice" description="Change, add or remove lines and hours with a reason. The payee is told; their original submission is kept.">
              <AmendInvoicePanel row={row} role={role} />
            </JobDisclosure>
          ) : null}
        </div>
        <aside aria-label="Comparison, Xero and history" className="flex min-w-0 flex-col gap-3.5 xl:w-[360px] xl:flex-none">
          <div className={cn("space-y-3.5", tabClass("compare"))}>
            <ComparisonCard review={review} />
            <XeroCard review={review} />
          </div>
          <div className={tabClass("history")}>
            <HistoryCard review={review} />
          </div>
        </aside>
      </div>
      <EPhoneActionBar label="Invoice actions" primary={primaryButton("h-11 w-full") ?? <span />} secondary={menu} hidden={!primary && !menu} />
      <CleanerInvoiceDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onDone={() => (dialog?.kind === "delete" ? router.push(backHref) : refresh())}
      />
    </div>
  );
}
