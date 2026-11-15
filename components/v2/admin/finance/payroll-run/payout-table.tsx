"use client";

/**
 * The payouts of a pay run: one column per stored money kind, "None" in
 * words, a tinted leading cell with the reason when something will stop the
 * money (tone band, no left line), and a row that opens to show the jobs and
 * rate snapshots behind it (collapsed by default, owner default 2026-11-17).
 * Desktop table from 640px; a list of cards with a bottom sheet below it.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EToneRowCell, ETonePill, tonePhoneBandClass, toneMutedClass } from "@/components/v2/ui/tone-band";
import {
  PAYOUT_METHOD_LABEL,
  PAYOUT_STATUS_LABEL,
  accountEnding,
  attentionFirst,
  isBankPayout,
  payoutMatchesFilter,
  type PayoutFilter,
  type PayoutMethodName,
  type PayoutStatusName,
} from "@/lib/payroll/run-presentation";
import type { PayrollPayoutView, PayrollRunView } from "@/lib/payroll/run-view";
import { aud, plural } from "../../pay-records/format";
import { MUTED, SMALL } from "../../pay-records/record-parts";
import { PayoutBreakdownBody, usePayoutBreakdown } from "./payout-breakdown";

const PAGE = 10;

const PAYOUT_TONE: Record<string, EPillTone> = {
  PENDING: "neutral",
  PROCESSING: "warn",
  PAID: "ok",
  FAILED: "bad",
  CANCELLED: "neutral",
  REFUNDED: "info",
};

export type PayoutActions = {
  onMarkPaid: (payout: PayrollPayoutView) => void;
  onChangeStatus: (payout: PayrollPayoutView) => void;
  /** Frozen while any request runs. */
  disabled: boolean;
};

function nameOf(payout: PayrollPayoutView): string {
  return payout.cleanerName || payout.cleanerEmail;
}

function money(value: number): string {
  return value === 0 ? "None" : aud(value);
}

function methodLine(payout: PayrollPayoutView): { method: string; detail: string | null } {
  const method = PAYOUT_METHOD_LABEL[payout.method as PayoutMethodName] ?? payout.method;
  if (isBankPayout(payout.method)) {
    const ending = accountEnding(payout.bankAccountNumber);
    return { method, detail: payout.bankBsb && ending ? `BSB ${payout.bankBsb} · acct ending ${ending}` : null };
  }
  return { method, detail: payout.stripeAccountId ? "account on file" : null };
}

export function payslipHref(run: Pick<PayrollRunView, "periodStart" | "periodEnd">, payout: Pick<PayrollPayoutView, "cleanerId">): string {
  return `/api/admin/finance/payroll/payslip?cleanerId=${encodeURIComponent(payout.cleanerId)}&startDate=${encodeURIComponent(run.periodStart.slice(0, 10))}&endDate=${encodeURIComponent(run.periodEnd.slice(0, 10))}`;
}

function rowMenu(payout: PayrollPayoutView, actions: PayoutActions, run: PayrollRunView): ERowMenuItem[] {
  const items: ERowMenuItem[] = [];
  if (payout.status !== "PAID") items.push({ key: "paid", label: "Mark paid…", onSelect: () => actions.onMarkPaid(payout) });
  items.push({ key: "status", label: "Change payout status…", onSelect: () => actions.onChangeStatus(payout) });
  items.push({ key: "payslip", label: "Payslip PDF", href: payslipHref(run, payout), newTab: true, separated: true });
  return items;
}

function PersonCell({ payout, open, onToggle }: { payout: PayrollPayoutView; open: boolean; onToggle: () => void }) {
  const tone = payout.status === "FAILED" ? "problem" : payout.problems.length ? "attention" : null;
  return (
    <EToneRowCell tone={tone} className="px-3 py-2.5 align-top">
      <button type="button" aria-expanded={open} onClick={onToggle} className="inline-flex items-center gap-1 text-left font-[600]">
        {open ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
        {nameOf(payout)}
        <span className="sr-only">{open ? ", hide what makes up this payout" : ", show what makes up this payout"}</span>
      </button>
      {payout.problems.map((problem) => (
        <ETonePill key={problem.code} tone={tone ?? "attention"} className="ml-1.5 align-middle">{problem.label}</ETonePill>
      ))}
      <p className={cn("text-[0.75rem]", tone ? toneMutedClass(tone) : MUTED)}>{plural(payout.jobCount, "job")}</p>
    </EToneRowCell>
  );
}

function DesktopRow({ run, payout, open, onToggle, actions }: { run: PayrollRunView; payout: PayrollPayoutView; open: boolean; onToggle: () => void; actions: PayoutActions }) {
  const method = methodLine(payout);
  const flagged = payout.problems[0];
  const breakdown = usePayoutBreakdown(run.id, open ? payout.id : null);
  return (
    <>
      <tr className={cn("border-t border-[hsl(var(--e-border))]", open && "bg-[hsl(var(--e-primary-soft)/0.5)]")}>
        <PersonCell payout={payout} open={open} onToggle={onToggle} />
        <td className={cn("px-3 py-2.5 align-top", SMALL)}>
          {method.method}
          {flagged ? (
            <p className="font-[600] text-[hsl(var(--e-warning))]">{flagged.detail}</p>
          ) : payout.failureReason ? (
            <p className="text-[hsl(var(--e-danger))]">Failed: {payout.failureReason}</p>
          ) : method.detail ? (
            <p className={MUTED}>{method.detail}</p>
          ) : null}
        </td>
        <td className={cn("e-tnum px-3 py-2.5 text-right align-top", payout.shoppingReimbursement === 0 && MUTED)}>{money(payout.shoppingReimbursement)}</td>
        <td className={cn("e-tnum px-3 py-2.5 text-right align-top", payout.transportAllowance === 0 && MUTED)}>{money(payout.transportAllowance)}</td>
        <td className={cn("e-tnum px-3 py-2.5 text-right align-top", payout.adjustments === 0 && MUTED)}>
          {payout.adjustments === 0 ? "None" : <Link href="/v2/admin/finance?tab=adjustments" className="underline underline-offset-2">{aud(payout.adjustments)}</Link>}
        </td>
        <td className="e-tnum px-3 py-2.5 text-right align-top font-[600]">{aud(payout.amount)}</td>
        <td className="px-3 py-2.5 align-top"><EPill tone={PAYOUT_TONE[payout.status] ?? "neutral"}>{PAYOUT_STATUS_LABEL[payout.status as PayoutStatusName] ?? payout.status}</EPill></td>
        <td className="px-3 py-2.5 text-right align-top">
          <div className="flex items-center justify-end gap-2">
            {flagged?.code === "NO_BANK_DETAILS" ? (
              <Link href={`/v2/admin/accounts?open=${encodeURIComponent(payout.cleanerId)}`} className={cn(SMALL, "underline underline-offset-2")}>Add bank details</Link>
            ) : (
              <a href={payslipHref(run, payout)} target="_blank" rel="noreferrer" className={cn(SMALL, "underline underline-offset-2")}>Payslip PDF</a>
            )}
            <ERowMenu label={`More actions for ${nameOf(payout)}'s payout`} items={rowMenu(payout, actions, run)} disabled={actions.disabled} />
          </div>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={8} className="bg-[hsl(var(--e-primary-soft)/0.5)] px-3 pb-3">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5">
              <PayoutBreakdownBody key={payout.id} state={breakdown} name={(payout.cleanerName || payout.cleanerEmail).split(" ")[0]} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PhoneSheet({ run, payout, onClose, actions }: { run: PayrollRunView; payout: PayrollPayoutView | null; onClose: () => void; actions: PayoutActions }) {
  const breakdown = usePayoutBreakdown(run.id, payout?.id ?? null);
  if (!payout) return null;
  const method = methodLine(payout);
  return (
    <EBottomSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={nameOf(payout)}
      description={`${method.method}${method.detail ? ` · ${method.detail}` : ""} · ${plural(payout.jobCount, "job")}`}
      footer={
        <div className="flex flex-col gap-1.5">
          <EButton asChild variant="outline" className="w-full"><a href={payslipHref(run, payout)} target="_blank" rel="noreferrer">Payslip PDF</a></EButton>
          {payout.status !== "PAID" ? <EButton variant="outline" className="w-full" disabled={actions.disabled} onClick={() => actions.onMarkPaid(payout)}>Mark paid…</EButton> : null}
          <EButton variant="ghost" className="w-full" disabled={actions.disabled} onClick={() => actions.onChangeStatus(payout)}>Change payout status…</EButton>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <EPill tone={PAYOUT_TONE[payout.status] ?? "neutral"}>{PAYOUT_STATUS_LABEL[payout.status as PayoutStatusName] ?? payout.status}</EPill>
          {payout.failureReason ? <span className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>Failed: {payout.failureReason}</span> : null}
        </div>
        <dl className={cn("divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3", SMALL)}>
          {[
            ["Shopping", money(payout.shoppingReimbursement)],
            ["Transport", money(payout.transportAllowance)],
            ["Adjustments", money(payout.adjustments)],
            ["Total", aud(payout.amount)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5">
              <dt className={label === "Total" ? "font-[600]" : MUTED}>{label}</dt>
              <dd className="e-tnum font-[600]">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[0.8125rem] font-[600]">Jobs at their rate snapshots</p>
        <PayoutBreakdownBody key={payout.id} state={breakdown} name={nameOf(payout).split(" ")[0]} compact />
        <p className={cn("text-[0.75rem]", MUTED)}>A rate changed today does not alter these.</p>
      </div>
    </EBottomSheet>
  );
}

export function PayoutTable({ run, actions }: { run: PayrollRunView; actions: PayoutActions }) {
  const [filter, setFilter] = React.useState<PayoutFilter>("all");
  const [openIds, setOpenIds] = React.useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = React.useState(PAGE);
  const [sheetId, setSheetId] = React.useState<string | null>(null);
  const counts = {
    all: run.payouts.length,
    attention: run.payouts.filter((payout) => payoutMatchesFilter(payout, "attention")).length,
    stripe: run.payouts.filter((payout) => payoutMatchesFilter(payout, "stripe")).length,
    bank: run.payouts.filter((payout) => payoutMatchesFilter(payout, "bank")).length,
  };
  const rows = run.payouts.filter((payout) => payoutMatchesFilter(payout, filter));
  const visible = rows.slice(0, shown);
  const sheetPayout = run.payouts.find((payout) => payout.id === sheetId) ?? null;
  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-labelledby="payouts-heading" className="min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 id="payouts-heading" className="text-[0.9375rem] font-[600]">Payouts</h2>
        <EFilterChips
          label="Show payouts"
          phoneLayout="carousel"
          active={filter}
          onChange={(key) => {
            setFilter(key);
            setShown(PAGE);
          }}
          chips={[
            { key: "all", label: "All", count: counts.all },
            { key: "attention", label: "Needs attention", count: counts.attention },
            { key: "stripe", label: "Stripe Connect", count: counts.stripe },
            { key: "bank", label: "Bank transfer", count: counts.bank },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <p className={cn("px-4 pb-4", SMALL, MUTED)}>{run.payouts.length ? "No payouts match this filter." : "No payouts in this run."}</p>
      ) : (
        <>
          <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="Payouts table" tabIndex={0}>
            <table className="w-full min-w-[56rem] text-[0.875rem]">
              <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-[500]">Person</th>
                  <th scope="col" className="px-3 py-2 text-left font-[500]">Paid by</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Shopping</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Transport</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Adjustments</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Total</th>
                  <th scope="col" className="px-3 py-2 text-left font-[500]">Payout</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((payout) => (
                  <DesktopRow key={payout.id} run={run} payout={payout} open={openIds.has(payout.id)} onToggle={() => toggle(payout.id)} actions={actions} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 px-3 pb-3 sm:hidden" aria-label="Payouts">
            {attentionFirst(visible).map((payout) => {
              const tone = payout.status === "FAILED" ? "problem" : payout.problems.length ? "attention" : null;
              const method = methodLine(payout);
              return (
                <li key={payout.id} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
                  <button type="button" onClick={() => setSheetId(payout.id)} className={cn("flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left", tone && tonePhoneBandClass(tone))}>
                    <span className="min-w-0">
                      <span className="block font-[600]">{nameOf(payout)} · {aud(payout.amount)}</span>
                      <span className={cn("block text-[0.75rem]", tone ? toneMutedClass(tone) : MUTED)}>{method.method} · {PAYOUT_STATUS_LABEL[payout.status as PayoutStatusName] ?? payout.status}</span>
                    </span>
                    {payout.problems[0] ? <ETonePill tone={tone ?? "attention"}>{payout.problems[0].label}</ETonePill> : payout.status === "FAILED" ? <ETonePill tone="problem">Failed</ETonePill> : <EPill tone={PAYOUT_TONE[payout.status] ?? "neutral"}>{PAYOUT_STATUS_LABEL[payout.status as PayoutStatusName] ?? payout.status}</EPill>}
                  </button>
                  {payout.problems[0]?.code === "NO_BANK_DETAILS" ? <p className={cn("px-3 py-2", SMALL)}>Not in the ABA file until bank details are added.</p> : null}
                  {payout.failureReason ? <p className={cn("px-3 py-2", SMALL)}>Failed: {payout.failureReason}</p> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-4 py-2.5">
        <p className={cn("text-[0.75rem]", MUTED)}>
          Showing {Math.min(shown, rows.length)} of {rows.length}. &quot;None&quot; means nothing of that kind on this payout. Each payout&apos;s status can be corrected from its row menu.
        </p>
        {rows.length > shown ? <EButton size="sm" variant="outline" onClick={() => setShown((value) => value + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</EButton> : null}
      </div>
      <PhoneSheet run={run} payout={sheetPayout} onClose={() => setSheetId(null)} actions={{ ...actions, onMarkPaid: (payout) => { setSheetId(null); actions.onMarkPaid(payout); }, onChangeStatus: (payout) => { setSheetId(null); actions.onChangeStatus(payout); } }} />
    </section>
  );
}
