/**
 * Pay → This period (approved cleaner board, 2026-11): the server's total for
 * the period so far, its parts, the default rate in force and where it comes
 * from, the period's jobs with their recorded status, and pending extra pay.
 * Presentational only; no money is computed here.
 */
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import Link from "next/link";
import { Info } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { formatAud } from "@/lib/cleaner/today-view";
import type { PayLine } from "@/lib/cleaner/pay-view";

export interface PayJobRow {
  jobId: string;
  property: string;
  date: string;
  hours: number;
  amount: number;
  statusLabel: string;
  rateMissing: boolean;
}

export interface PayRateView {
  rate: number;
  /** "1 Jul 2026"; null when the rate has no dated history. */
  fromLabel: string | null;
}

export interface PayPeriodProps {
  periodLabel: string;
  total: number;
  jobCount: number;
  lines: PayLine[];
  rate: PayRateView | null;
  rows: PayJobRow[];
  pendingCount: number;
  pendingAmount: number;
  gapJobCount: number;
}

export function PayPeriod({ periodLabel, total, jobCount, lines, rate, rows, pendingCount, pendingAmount, gapJobCount }: PayPeriodProps) {
  return (
    <div className="space-y-4">
      <ECard className="space-y-3 p-4">
        <p className="e-eyebrow">{periodLabel} · so far</p>
        <div className="flex items-baseline justify-between gap-3">
          <p className="e-numeral text-[2rem] leading-none">{formatAud(total)}</p>
          <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{jobCount} job{jobCount === 1 ? "" : "s"}</span>
        </div>
        <dl className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[hsl(var(--e-text-secondary))]">{line.label}</dt>
              <dd className="tabular-nums font-[550]">{formatAud(line.amount)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {rate
            ? `Your default rate ${formatAud(rate.rate)} / h${rate.fromLabel ? ` from ${rate.fromLabel}` : ""} · set by the office. Some job types pay a rate the office sets per job type.`
            : "Your default rate is not recorded. Ask the office."}
        </p>
      </ECard>

      {gapJobCount > 0 ? (
        <p role="note" className={`rounded-[var(--e-radius)] ${toneNoticeClass("attention")} p-3 text-[0.8125rem]`}>
          {gapJobCount} job{gapJobCount === 1 ? " was" : "s were"} finished after this period ended and {gapJobCount === 1 ? "is" : "are"} not counted here. Check with the office before you send the invoice.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EEmptyState eyebrow="Nothing yet" title="No payable jobs" description="Completed and submitted jobs in this period will show here with their pay." />
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          {rows.map((row) => (
            <li key={row.jobId}>
              <Link href={`/v2/cleaner/jobs/${row.jobId}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2.5 hover:bg-[hsl(var(--e-muted))]">
                <span className="min-w-0">
                  <span className="block truncate text-[0.875rem] font-[600]">{row.property}</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {row.date} · {row.hours.toFixed(1)} h · {row.statusLabel}{row.rateMissing ? " · rate missing" : ""}
                  </span>
                </span>
                <span className="e-numeral shrink-0 text-[0.9375rem]">{formatAud(row.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pendingCount > 0 ? (
        <Link href="/v2/cleaner/pay?tab=requests" className="flex min-h-12 items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5 hover:bg-[hsl(var(--e-muted))]">
          <span className="text-[0.875rem] font-[600]">Extra pay requests waiting for the office</span>
          <EBadge tone="warning" soft>{pendingCount} · {formatAud(pendingAmount)} pending</EBadge>
        </Link>
      ) : null}

      <p className="flex items-start gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Pending extra pay is not in the total until the office approves it. You can review hours and add comments on the invoice before it is emailed.
      </p>

      <EButton asChild variant="gold" className="min-h-11 w-full">
        <Link href="/v2/cleaner/pay?tab=requests">New extra pay request</Link>
      </EButton>
    </div>
  );
}
