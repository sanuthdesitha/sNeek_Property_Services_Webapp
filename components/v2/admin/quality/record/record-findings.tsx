"use client";

/**
 * Findings by area on the inspection record (board "QualityInspection",
 * left column; board "M-QualityDetail", frame 4). Areas with an issue open on
 * their issues; the rest of an area, and areas with nothing recorded, fold to
 * one line with a Show disclosure. An item without a stored issue reads "No
 * issue recorded": Pass and N/A are not stored separately, so neither is
 * claimed.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";
import { toneBandClass, toneMutedClass } from "@/components/v2/ui/tone-band";
import type { InspectionRecord, RecordArea, RecordIssue, RecordItem } from "@/lib/quality/inspection-record-types";
import { rectificationLabel } from "@/lib/quality/issue-presentation";
import type { EvidenceUrls } from "../issues/issue-evidence";
import { RecordThumb } from "./record-thumb";

const VERDICT_WORD: Readonly<Record<string, string>> = {
  PASS: "Pass",
  MINOR: "Minor",
  FAIL: "Fail",
  MAJOR: "Major",
  CRITICAL: "Critical",
  NA: "N/A",
};

function verdictCountsText(area: RecordArea): string {
  const counts = new Map<string, number>();
  for (const item of area.items) if (item.issue) counts.set(item.issue.verdictLabel, (counts.get(item.issue.verdictLabel) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([label, count]) => `${count} ${label.toLowerCase()}`)
    .join(" · ");
}

/** Read-only verdict scale: the option this issue recorded is filled. */
function VerdictScale({ options, chosen }: { options: string[]; chosen: string }) {
  return (
    <span className="max-sm:hidden" aria-label={`Verdict: ${VERDICT_WORD[chosen] ?? chosen}`} role="img">
      <span aria-hidden className="inline-flex overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[0.75rem]">
        {options.map((option) => (
          <span
            key={option}
            className={cn(
              "px-2.5 py-1",
              option !== options[0] && "border-l border-[hsl(var(--e-border))]",
              option === chosen ? "bg-[hsl(var(--e-band-attention-line))] font-[650] text-[hsl(var(--e-band-attention-fg))]" : "text-[hsl(var(--e-muted-foreground))]",
            )}
          >
            {VERDICT_WORD[option] ?? option}
          </span>
        ))}
      </span>
    </span>
  );
}

function falseConfirmationText(status: string): string | null {
  if (status === "SUSPECTED") return "Flagged by the inspector. The office decides in the issue.";
  if (status === "CONFIRMED") return "Confirmed by the office.";
  if (status === "REJECTED") return "Rejected by the office; the points were given back.";
  return null;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 max-sm:grid-cols-1 max-sm:gap-0">
      <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function IssueItem({
  item,
  issue,
  options,
  urls,
  issueHref,
}: {
  item: RecordItem;
  issue: RecordIssue;
  options: string[];
  urls: EvidenceUrls;
  issueHref: (issueId: string) => string;
}) {
  const fc = falseConfirmationText(issue.falseConfirmation);
  const photo = issue.qaPhotos[0];
  return (
    <li className={cn("border-b px-4 py-3 last:border-b-0", toneBandClass("attention"))}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-2 font-[600]">
          <span className="[overflow-wrap:anywhere]">{item.label}</span>
          {issue.cleanerMarkedComplete ? <EPill tone="info">Cleaner marked complete</EPill> : null}
        </p>
        <VerdictScale options={options} chosen={issue.verdictKey} />
        <span className="sm:hidden">
          <EPill tone="warn">{issue.verdictLabel}</EPill>
        </span>
      </div>
      <div className="mt-2 flex gap-3 max-sm:flex-col">
        {photo ? (
          <RecordThumb url={urls[photo.key]} label={photo.markedUp ? "QA photo · marked up" : "QA photo"} alt={`QA photo of ${item.label}`} size="lg" />
        ) : null}
        <dl className={cn("min-w-0 flex-1 space-y-1 text-[0.8125rem]", toneMutedClass("attention"))}>
          <Detail label="Category">{issue.categoryLabel}</Detail>
          <Detail label="What was wrong">{issue.description}</Detail>
          {fc ? <Detail label="False confirmation">{fc}</Detail> : null}
          <Detail label="Issue">
            <Link href={issueHref(issue.id)} className="underline underline-offset-2">
              {`QA issue · ${rectificationLabel(issue.rectificationStatus)}`}
            </Link>
          </Detail>
        </dl>
      </div>
    </li>
  );
}

function QuietItems({ items, label }: { items: RecordItem[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <li className="border-b border-[hsl(var(--e-border))] last:border-b-0">
      <details className="group px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
          <span>{label}</span>
          <span className="underline underline-offset-2 group-open:hidden">Show</span>
          <span className="hidden underline underline-offset-2 group-open:inline">Hide</span>
        </summary>
        <ul className="space-y-1 pb-2 text-[0.8125rem]">
          {items.map((item) => (
            <li key={item.fieldId} className="flex justify-between gap-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
              <span className="shrink-0 text-[hsl(var(--e-muted-foreground))]">No issue recorded</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function AreaBlock({ area, record, urls, issueHref }: { area: RecordArea; record: InspectionRecord; urls: EvidenceUrls; issueHref: (issueId: string) => string }) {
  const quiet = area.items.filter((item) => !item.issue);
  const header = (
    <>
      <span className="font-[600]">
        {area.title} · {area.items.length} {area.items.length === 1 ? "item" : "items"}
      </span>
      {area.issueCount > 0 ? <EPill tone="warn">{verdictCountsText(area)}</EPill> : <EPill tone="ok">No issues recorded</EPill>}
    </>
  );
  if (area.issueCount === 0) {
    return (
      <li className="border-t border-[hsl(var(--e-border))]">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 bg-[hsl(var(--e-muted)/0.5)] px-4 py-2.5">
            {header}
          </summary>
          <ul className="px-4 py-2 text-[0.8125rem]">
            {area.items.map((item) => (
              <li key={item.fieldId} className="flex justify-between gap-2 py-0.5">
                <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
                <span className="shrink-0 text-[hsl(var(--e-muted-foreground))]">No issue recorded</span>
              </li>
            ))}
            {area.items.length === 0 ? <li className="text-[hsl(var(--e-muted-foreground))]">No graded items in this area.</li> : null}
          </ul>
        </details>
      </li>
    );
  }
  return (
    <li className="border-t border-[hsl(var(--e-border))]">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 bg-[hsl(var(--e-muted)/0.5)] px-4 py-2.5">{header}</div>
      <ul>
        {area.items.map((item) =>
          item.issue ? <IssueItem key={item.issue.id} item={item} issue={item.issue} options={record.verdictOptions} urls={urls} issueHref={issueHref} /> : null,
        )}
        <QuietItems items={quiet} label={`${quiet.length} more ${area.title.toLowerCase()} ${quiet.length === 1 ? "item" : "items"}, no issue recorded`} />
      </ul>
    </li>
  );
}

export function RecordFindings({ record, urls }: { record: InspectionRecord; urls: EvidenceUrls }) {
  // An issue opens in the Issues tab, over a period that includes the day it was raised.
  const issueHref = React.useCallback(
    (issueId: string) => {
      const from = record.submittedAt ? formatInTimeZone(new Date(record.submittedAt), record.timeZone, "yyyy-MM-dd") : null;
      const to = formatInTimeZone(new Date(), record.timeZone, "yyyy-MM-dd");
      const params = new URLSearchParams({ tab: "issues", q: issueId });
      if (from && from <= to) {
        params.set("period", "custom");
        params.set("from", from);
        params.set("to", to);
      }
      return `/v2/admin/quality?${params.toString()}`;
    },
    [record.submittedAt, record.timeZone],
  );

  return (
    <section id="record-findings" aria-labelledby="record-findings-title" className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 id="record-findings-title" className="text-[0.9375rem] font-[650]">
          Findings · {record.templateLabel}
        </h2>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {record.itemCount} items · {record.issueCount} with an issue · {Math.max(0, record.itemCount - record.issueCount)} with no issue recorded
        </p>
      </div>
      {record.areas.length === 0 ? (
        <p className="border-t border-[hsl(var(--e-border))] px-4 py-3 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          The inspection form&apos;s areas could not be read, so findings are listed only as issues.
        </p>
      ) : null}
      <ul>
        {record.areas.map((area) => (
          <AreaBlock key={area.id} area={area} record={record} urls={urls} issueHref={issueHref} />
        ))}
      </ul>
      <p className="border-t border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Pass and N/A are not stored separately, so items without an issue say &quot;No issue recorded&quot;.
      </p>
    </section>
  );
}
