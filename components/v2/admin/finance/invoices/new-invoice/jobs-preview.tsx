"use client";

/**
 * "What the draft will hold": every job the generator would bill for the
 * selection, grouped by property, with where its charge comes from and its
 * amount ex GST, the other lines the generator adds (shopping, client-paid
 * repairs), the totals and what was left out. Every figure is the server's
 * (the generator's own functions); this component only displays them. A job
 * with no rate shows "No charge" and offers its two fixes in place.
 *
 * Phones: the table becomes one card per job under its property heading; the
 * totals stay beneath.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { ECard } from "@/components/v2/ui/primitives";
import { toneRowCellClass, tonePhoneBandClass } from "@/components/v2/ui/tone-band";
import type { GeneratePreview, PreviewJob, PreviewLeftOut } from "@/lib/billing/client-invoice-generate-preview-types";
import { RateFixLinks } from "./rate-fixes";
import { chargeFromText, formatMoney, jobDayText, jobLabel, jobTypeText } from "./new-invoice-format";
import type { PreviewState } from "./use-new-invoice-data";

type PropertyGroup = { propertyId: string; propertyName: string; jobs: PreviewJob[] };

function groupByProperty(jobs: PreviewJob[]): PropertyGroup[] {
  const groups = new Map<string, PropertyGroup>();
  for (const job of jobs) {
    const group = groups.get(job.propertyId) ?? { propertyId: job.propertyId, propertyName: job.propertyName, jobs: [] };
    group.jobs.push(job);
    groups.set(job.propertyId, group);
  }
  return Array.from(groups.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

function countsLine(preview: GeneratePreview): string {
  const found = preview.jobs.length;
  const unrated = preview.unratedJobIds.length;
  return [`${found} job${found === 1 ? "" : "s"} found`, `${preview.chargedJobCount} with a charge`, unrated ? `${unrated} without a rate` : null].filter(Boolean).join(" · ");
}

function leftOutLine(leftOut: PreviewLeftOut[]): string | null {
  if (leftOut.length === 0) return null;
  const invoiced = new Map<string, string[]>();
  const parts: string[] = [];
  for (const row of leftOut) {
    const name = row.jobNumber ?? "a job";
    if (row.reason === "ALREADY_INVOICED") {
      const key = row.invoiceNumber ?? "another invoice";
      invoiced.set(key, [...(invoiced.get(key) ?? []), name]);
    } else {
      parts.push(`${name} (${row.reason === "CANCELLED" ? "cancelled" : "skipped clean"})`);
    }
  }
  for (const [invoice, names] of Array.from(invoiced.entries())) {
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    parts.push(`${list} (already on ${invoice})`);
  }
  return `Left out: ${parts.join(", ")}.`;
}

function ChargeCell({ job, frozen, onFixed }: { job: PreviewJob; frozen: boolean; onFixed: () => void }) {
  if (job.source !== "MISSING") return <span className="[overflow-wrap:anywhere]">{chargeFromText(job)}</span>;
  return (
    <span className="[overflow-wrap:anywhere]">
      <b className="font-[600]">No rate</b> for {jobTypeText(job.jobType).toLowerCase()} at {job.propertyName}
      <RateFixLinks job={job} disabled={frozen} onSaved={onFixed} />
    </span>
  );
}

function AmountText({ job }: { job: PreviewJob }) {
  return job.amount === null ? <span className="text-[hsl(var(--e-text-secondary))]">No charge</span> : <span className="e-tnum">{formatMoney(job.amount)}</span>;
}

function PreviewTable({ groups, timeZone, frozen, onFixed }: { groups: PropertyGroup[]; timeZone: string; frozen: boolean; onFixed: () => void }) {
  return (
    <div role="region" aria-label="Jobs on the draft" tabIndex={0} className="overflow-x-auto max-sm:hidden">
      <table className="w-full min-w-[560px] border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] text-left text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <th scope="col" className="px-3.5 py-2 font-[600]">Job</th>
            <th scope="col" className="px-2 py-2 font-[600]">Date</th>
            <th scope="col" className="px-2 py-2 font-[600]">Type</th>
            <th scope="col" className="px-2 py-2 font-[600]">Charge from</th>
            <th scope="col" className="px-3.5 py-2 text-right font-[600]">Ex GST</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.propertyId}>
            <tr className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]">
              <th scope="rowgroup" colSpan={5} className="px-3.5 py-1.5 text-left text-[0.6875rem] font-[650] uppercase tracking-[0.08em] text-[hsl(var(--e-gold))]">
                {group.propertyName}
              </th>
            </tr>
            {group.jobs.map((job) => {
              const unrated = job.source === "MISSING";
              return (
                <tr key={job.jobId} className="border-b border-[hsl(var(--e-border))] align-top">
                  <th scope="row" className={cn("whitespace-nowrap px-3.5 py-2.5 text-left font-[500]", unrated && toneRowCellClass("problem"))}>
                    <a href={`/v2/admin/jobs/${encodeURIComponent(job.jobId)}`} className="underline-offset-2 hover:underline">{jobLabel(job)}</a>
                  </th>
                  <td className="whitespace-nowrap px-2 py-2.5">{jobDayText(job.scheduledDate, timeZone)}</td>
                  <td className="px-2 py-2.5">{jobTypeText(job.jobType)}</td>
                  <td className="px-2 py-2.5">
                    <ChargeCell job={job} frozen={frozen} onFixed={onFixed} />
                    {job.note && job.source !== "FIXED_JOB" ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Line note: {job.note}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right"><AmountText job={job} /></td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PreviewPhoneList({ groups, timeZone, frozen, onFixed }: { groups: PropertyGroup[]; timeZone: string; frozen: boolean; onFixed: () => void }) {
  return (
    <div className="space-y-3 px-3.5 pb-1 sm:hidden">
      {groups.map((group) => (
        <section key={group.propertyId} aria-label={group.propertyName}>
          <h3 className="pb-1.5 text-[0.6875rem] font-[650] uppercase tracking-[0.08em] text-[hsl(var(--e-gold))]">{group.propertyName}</h3>
          <ul className="space-y-2">
            {group.jobs.map((job) => {
              const unrated = job.source === "MISSING";
              return (
                <li key={job.jobId} className="overflow-hidden rounded-[10px] border border-[hsl(var(--e-border))]">
                  <div className={cn("flex items-baseline justify-between gap-2 px-3 py-2", unrated && tonePhoneBandClass("problem"))}>
                    <a href={`/v2/admin/jobs/${encodeURIComponent(job.jobId)}`} className="min-h-8 content-center font-[600] underline-offset-2 hover:underline">{jobLabel(job)}</a>
                    <AmountText job={job} />
                  </div>
                  <div className="space-y-0.5 px-3 pb-2.5 text-[0.8125rem]">
                    <p className="text-[hsl(var(--e-text-secondary))]">{jobDayText(job.scheduledDate, timeZone)} · {jobTypeText(job.jobType)}</p>
                    <p><ChargeCell job={job} frozen={frozen} onFixed={onFixed} /></p>
                    {job.note && job.source !== "FIXED_JOB" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Line note: {job.note}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-end gap-6">
      <dt className="min-w-0 text-right text-[hsl(var(--e-text-secondary))]">{label}</dt>
      <dd className={cn("e-tnum w-28 shrink-0 text-right", strong && "font-[650]")}>{value}</dd>
    </div>
  );
}

function Totals({ preview }: { preview: GeneratePreview }) {
  const unratedNames = preview.jobs.filter((job) => job.source === "MISSING").map(jobLabel);
  return (
    <div className="space-y-2 border-t border-[hsl(var(--e-border))] px-3.5 py-3 text-[0.8125rem]">
      <dl className="space-y-1">
        <TotalRow label="Charged jobs, ex GST" value={preview.jobTotals ? formatMoney(preview.jobTotals.subtotal) : "No charged jobs"} strong />
        {preview.otherLines.map((line) => (
          <TotalRow key={line.key} label={line.description} value={formatMoney(line.amount)} />
        ))}
        {preview.totals ? (
          <>
            <TotalRow label="GST" value={preview.gstEnabled ? formatMoney(preview.totals.gstAmount) : "No GST"} strong />
            <TotalRow
              label={preview.otherLines.length ? `Total for ${preview.lineCount} line${preview.lineCount === 1 ? "" : "s"}` : `Total for ${preview.chargedJobCount} job${preview.chargedJobCount === 1 ? "" : "s"}`}
              value={formatMoney(preview.totals.totalAmount)}
              strong
            />
          </>
        ) : null}
      </dl>
      <p className="text-right text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Figures come from the billing service, the same calculation the draft uses.
        {unratedNames.length ? ` ${unratedNames.join(", ")} ${unratedNames.length === 1 ? "is" : "are"} not in them.` : ""}
      </p>
      {leftOutLine(preview.leftOut) ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{leftOutLine(preview.leftOut)}</p> : null}
    </div>
  );
}

export function JobsPreviewCard({ state, timeZone, frozen, onFixed, onRetry }: { state: PreviewState; timeZone: string; frozen: boolean; onFixed: () => void; onRetry: () => void }) {
  const preview = state.status === "ready" ? state.preview : state.status === "loading" || state.status === "error" ? state.previous : null;
  const groups = preview ? groupByProperty(preview.jobs) : [];
  const empty = preview !== null && preview.jobs.length === 0 && preview.otherLines.length === 0;
  return (
    <ECard role="region" className="overflow-hidden" aria-labelledby="ni-preview-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 py-3">
        <h2 id="ni-preview-title" className="text-[0.9375rem] font-[650]">
          What the draft will hold{" "}
          <span className="ml-1 rounded-full bg-[hsl(var(--e-info-soft))] px-2 py-0.5 align-middle text-[0.6875rem] font-[600] text-[hsl(var(--e-info))]">new preview</span>
        </h2>
        {preview && state.status === "ready" ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{countsLine(preview)}</p> : null}
      </div>
      {state.status === "idle" ? (
        <p className="px-3.5 pb-4 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Choose a client to see the jobs the draft would hold.</p>
      ) : null}
      {state.status === "loading" ? (
        <p role="status" className="px-3.5 pb-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {preview ? "Updating the preview…" : "Loading the jobs for this client and period…"}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="mx-3.5 mb-3 flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
          <span className="min-w-0 flex-1">{preview ? `Showing the last preview; it could not be refreshed: ${state.message}` : state.message}</span>
          <button type="button" onClick={onRetry} className="min-h-8 font-[600] underline max-sm:min-h-11">Try again</button>
        </div>
      ) : null}
      {empty && state.status === "ready" ? (
        <p className="px-3.5 pb-4 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No jobs, shopping or repairs in this period are waiting to be billed for this client.</p>
      ) : null}
      {preview && !empty ? (
        <div className={cn(state.status !== "ready" && "opacity-70")} aria-busy={state.status === "loading"}>
          <PreviewTable groups={groups} timeZone={timeZone} frozen={frozen || state.status !== "ready"} onFixed={onFixed} />
          <PreviewPhoneList groups={groups} timeZone={timeZone} frozen={frozen || state.status !== "ready"} onFixed={onFixed} />
          <Totals preview={preview} />
        </div>
      ) : null}
      {preview && empty && state.status === "ready" && leftOutLine(preview.leftOut) ? (
        <p className="border-t border-[hsl(var(--e-border))] px-3.5 py-3 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{leftOutLine(preview.leftOut)}</p>
      ) : null}
    </ECard>
  );
}
