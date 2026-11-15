"use client";

/**
 * What makes up one payout: the jobs this run stamped with their stored rate
 * snapshots, and the settled shopping, adjustments and inspections at their
 * stored amounts (lib/payroll/payout-breakdown.ts). Loaded when opened; a
 * read for an earlier payout is cancelled and never fills this one.
 * Display only: no amount is computed here.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PayoutBreakdown } from "@/lib/payroll/payout-breakdown";
import { audOr, calendarDay } from "../../pay-records/format";
import { MUTED, SMALL } from "../../pay-records/record-parts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PayoutBreakdown };

const FIRST_JOBS = 3;

export function usePayoutBreakdown(runId: string, payoutId: string | null): LoadState | null {
  const [state, setState] = React.useState<LoadState | null>(null);
  React.useEffect(() => {
    if (!payoutId) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    (async () => {
      try {
        const response = await fetch(`/api/admin/payroll/runs/${runId}/breakdown?payoutId=${encodeURIComponent(payoutId)}`, { signal: controller.signal, cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as PayoutBreakdown & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setState({ status: "error", message: body.error ?? "What makes up this payout could not be read." });
          return;
        }
        if (body.payoutId !== payoutId) return;
        setState({ status: "ready", data: body });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "What makes up this payout could not be read." });
      }
    })();
    return () => controller.abort();
  }, [runId, payoutId]);
  return state;
}

function rateText(rate: number | null, multiplier: number | null): string {
  if (rate === null) return "Not stored";
  return `${audOr(rate, "Not stored")}/h${multiplier ? ` · holiday ×${multiplier}` : ""}`;
}

export function PayoutBreakdownBody({ state, name, compact = false }: { state: LoadState | null; name: string; compact?: boolean }) {
  const [showAll, setShowAll] = React.useState(false);
  if (!state || state.status === "loading") return <p role="status" className={cn(SMALL, MUTED)}>Reading what makes up {name}&apos;s payout…</p>;
  if (state.status === "error") return <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>{state.message}</p>;
  const { jobs, shopping, adjustments, inspections } = state.data;
  const visibleJobs = showAll ? jobs : jobs.slice(0, FIRST_JOBS);
  const lines = [...shopping, ...inspections, ...adjustments];
  return (
    <div className="space-y-2">
      {compact ? null : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[0.8125rem] font-[600]">What makes up {name}&apos;s payout</p>
          <p className={cn("text-[0.75rem]", MUTED)}>Rates are the snapshots stored when each job was assigned. A rate change today does not alter them.</p>
        </div>
      )}
      {jobs.length ? (
        compact ? (
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {visibleJobs.map((job) => (
              <li key={job.jobId} className={cn("flex justify-between gap-3 py-1.5", SMALL)}>
                <span className="min-w-0 break-words">{job.jobNumber ?? "Job"} {job.propertyName} · {calendarDay(job.day)}</span>
                <span className="e-tnum shrink-0">{rateText(job.rateSnapshot, job.holidayMultiplier)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[0.8125rem]">
              <caption className="sr-only">Jobs on {name}&apos;s payout</caption>
              <thead className={cn("text-[0.75rem]", MUTED)}>
                <tr>
                  <th scope="col" className="py-1 pr-3 font-[500]">Job</th>
                  <th scope="col" className="py-1 pr-3 font-[500]">Property</th>
                  <th scope="col" className="py-1 pr-3 font-[500]">Day</th>
                  <th scope="col" className="py-1 text-right font-[500]">Rate snapshot</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr key={job.jobId} className="border-t border-[hsl(var(--e-border))]">
                    <td className="py-1.5 pr-3">
                      <Link href={`/v2/admin/jobs/${job.jobId}`} className="underline-offset-2 hover:underline">{job.jobNumber ?? "Job"}</Link>
                      {job.assignmentRemoved ? <span className={MUTED}> · since taken off the job</span> : null}
                    </td>
                    <td className="py-1.5 pr-3">{job.propertyName}</td>
                    <td className="py-1.5 pr-3">{calendarDay(job.day)}</td>
                    <td className="e-tnum py-1.5 text-right">{rateText(job.rateSnapshot, job.holidayMultiplier)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <p className={cn(SMALL, MUTED)}>No jobs on this run carry {name}&apos;s assignment.</p>
      )}
      {jobs.length > FIRST_JOBS ? (
        <button type="button" onClick={() => setShowAll((value) => !value)} className={cn(SMALL, "underline underline-offset-2")}>
          {showAll ? "Show fewer jobs" : `${jobs.length - FIRST_JOBS} more jobs · Show all ${jobs.length}`}
        </button>
      ) : null}
      <p className={cn("text-[0.75rem]", MUTED)}>A pay run stores each person&apos;s totals, not an amount per job, so jobs show their rate snapshot only.</p>
      {lines.length ? (
        <ul className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))]">
          {lines.map((line) => (
            <li key={line.id} className={cn("flex justify-between gap-3 py-1.5", SMALL)}>
              <span className="min-w-0 break-words">
                {line.label}
                {line.detail ? <span className={MUTED}> ({line.detail})</span> : null}
              </span>
              <span className="e-tnum shrink-0">{audOr(line.amount, "Not stored")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {adjustments.length ? (
        <Link href="/v2/admin/finance?tab=adjustments" className={cn(SMALL, "underline underline-offset-2")}>Adjustments</Link>
      ) : null}
    </div>
  );
}
