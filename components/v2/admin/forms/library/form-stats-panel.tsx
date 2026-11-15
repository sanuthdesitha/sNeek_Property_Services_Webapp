// Results and stats tab of the Forms library (formerly the standalone
// /v2/admin/forms/stats page, which redirects here keeping `templateId` and
// `weeks`). Board "Forms: results and stats" (2026-11-17): form and range
// picker, five figures, the weekly chart beside the ONE checks switch, the
// per-question table (answered, skipped, "No" with reasons, QA issues after)
// with its sort, and the by-area table. Panel mode: no heading of its own.
// Data and definitions: lib/forms/form-stats-data.ts. Unknown is never zero.
import type { ReactNode } from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { toneRowCellClass, tonePhoneBandClass } from "@/components/v2/ui/tone-band";
import { EBar } from "@/components/v2/admin/forms/management/estate-stats-bars";
import { loadFormStats, STATS_WEEK_CHOICES, type FormStatsData } from "@/lib/forms/form-stats-data";
import { topEntry } from "@/lib/forms/qa-issues-after";
import { cn } from "@/lib/utils";
import { FormStatsControls } from "./form-stats-controls";
import { ValidationEnforcementCard } from "./validation-enforcement-card";
import {
  buildQuestionRows,
  formatCompletion,
  parseQuestionSort,
  QUESTION_SORTS,
  sortQuestionRows,
  statsHref,
  type AreaIssues,
  type QaAfterLookup,
  type QuestionRow,
} from "./form-stats-rows";

/** Rows shown before "Show all". */
const QUESTION_PREVIEW = 10;

export type FormStatsSearch = { templateId?: string; weeks?: string; qsort?: string; qall?: string };

function qaLookup(data: FormStatsData): QaAfterLookup {
  if (data.qaAfter.status === "failed") return { status: "failed" };
  const labels = data.qaAfter.categoryLabels;
  const byArea = new Map<string, AreaIssues>();
  data.qaAfter.result.byArea.forEach((tally, area) => {
    const category = topEntry(tally.categories);
    const cleaner = topEntry(tally.cleaners);
    byArea.set(area, {
      count: tally.count,
      confirmedFalse: tally.confirmedFalse,
      topCategory: category ? labels[category.key] ?? category.key : null,
      topCleaner: cleaner ? { name: cleaner.key, count: cleaner.count } : null,
    });
  });
  return { status: "ready", byArea };
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <ECard className="min-w-0 p-4">
      <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{label}</p>
      <p className="e-tnum mt-0.5 font-serif text-[1.75rem] leading-tight text-[hsl(var(--e-foreground))]">{value}</p>
      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{note}</p>
    </ECard>
  );
}

function WeeklyChart({ data }: { data: FormStatsData }) {
  const max = Math.max(1, ...data.weekBuckets.map((bucket) => bucket.count));
  const partial = data.weekBuckets.find((bucket) => bucket.partial);
  return (
    <ECard className="min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[0.9375rem] font-[600]">Submissions per week</h3>
        <span className="min-w-0 truncate text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{data.template?.name}</span>
      </div>
      <div className="flex h-40 items-end gap-1.5" aria-hidden="true">
        {data.weekBuckets.map((bucket) => {
          const height = bucket.count > 0 ? Math.max(4, Math.round((bucket.count / max) * 100)) : 1.5;
          return (
            <div key={bucket.weekStart} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="e-tnum text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">{bucket.count}</span>
              <div
                className={cn("w-full rounded-t-[var(--e-radius-sm)]", bucket.partial ? "bg-[hsl(var(--e-primary)/0.5)]" : "bg-[hsl(var(--e-primary))]")}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5" aria-hidden="true">
        {data.weekBuckets.map((bucket) => (
          <span key={bucket.weekStart} className="min-w-0 flex-1 truncate text-center text-[0.625rem] text-[hsl(var(--e-text-faint))]">
            {bucket.label}{bucket.partial ? "*" : ""}
          </span>
        ))}
      </div>
      <details className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        <summary className="cursor-pointer">
          {partial ? `* Week of ${partial.label} is not finished (to ${data.partialWeekTo}). ` : ""}
          <span className="font-[550] underline">Show as a table</span>
        </summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Submissions per week, {data.template?.name}</caption>
          <thead>
            <tr><th scope="col" className="py-1 font-[550]">Week of</th><th scope="col" className="py-1 text-right font-[550]">Submissions</th></tr>
          </thead>
          <tbody className="e-tnum">
            {data.weekBuckets.map((bucket) => (
              <tr key={bucket.weekStart}>
                <td className="py-0.5">{bucket.label}{bucket.partial ? " (not finished)" : ""}</td>
                <td className="py-0.5 text-right">{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </ECard>
  );
}

function AnsweredCell({ row }: { row: QuestionRow }) {
  return (
    <div className="flex items-center gap-2">
      <span className="e-tnum w-10 text-[0.8125rem]">{row.answeredText}</span>
      {row.answeredPct !== null ? <div className="w-20"><EBar value={row.answeredPct} max={100} tone="primary" /></div> : null}
    </div>
  );
}

function ResultCell({ row }: { row: QuestionRow }) {
  return (
    <div className="min-w-0">
      <span className={row.resultTone === "bad" ? "font-[600] text-[hsl(var(--e-danger))]" : ""}>{row.result}</span>
      {row.resultDetail ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.resultDetail}</p> : null}
    </div>
  );
}

function QuestionsCard({ data, rows, sort, showAll }: { data: FormStatsData; rows: QuestionRow[]; sort: string; showAll: boolean }) {
  const visible = showAll ? rows : rows.slice(0, QUESTION_PREVIEW);
  const notPlaced = data.qaAfter.status === "ready" ? data.qaAfter.result.notPlaced : 0;
  return (
    <ECard className="min-w-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <h3 className="text-[0.9375rem] font-[600]">Questions · {rows.length}</h3>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span id="question-sort-label" className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Sort</span>
          <nav aria-labelledby="question-sort-label" className="flex max-w-full overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]">
            {QUESTION_SORTS.map((option, index) => (
              <Link
                key={option.key}
                href={statsHref({ templateId: data.templateId, weeks: data.weeks, qsort: option.key, qall: showAll })}
                scroll={false}
                aria-current={option.key === sort ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap px-3 text-[0.8125rem] font-[550] max-sm:min-h-11",
                  index > 0 && "border-l border-[hsl(var(--e-border))]",
                  option.key === sort ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-surface-raised))]",
                )}
              >
                {option.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-[hsl(var(--e-border))] p-6 text-center text-[0.875rem] text-[hsl(var(--e-text-secondary))]">This form has no questions.</p>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-[hsl(var(--e-border))] max-sm:hidden" role="region" aria-label="Questions" tabIndex={0}>
            <table className="w-full min-w-[56rem] text-left text-[0.8125rem]">
              <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                <tr>
                  <th scope="col" className="px-4 py-2 font-[550]">Question</th>
                  <th scope="col" className="px-4 py-2 font-[550]">Type</th>
                  <th scope="col" className="px-4 py-2 font-[550]">Answered</th>
                  <th scope="col" className="px-4 py-2 text-right font-[550]">Skipped</th>
                  <th scope="col" className="px-4 py-2 font-[550]">Result</th>
                  <th scope="col" className="px-4 py-2 font-[550]">QA issues after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--e-border))]">
                {visible.map((row) => (
                  <tr key={row.id} className="align-top">
                    <th scope="row" className={cn("px-4 py-2.5 text-left font-normal", row.flagged && toneRowCellClass("attention"))}>
                      <span className="block font-[600]">{row.label}</span>
                      <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.sub}</span>
                    </th>
                    <td className="px-4 py-2.5">{row.typeLabel}</td>
                    <td className="px-4 py-2.5"><AnsweredCell row={row} /></td>
                    <td className="e-tnum px-4 py-2.5 text-right">{row.skippedText}</td>
                    <td className="px-4 py-2.5"><ResultCell row={row} /></td>
                    <td className="px-4 py-2.5">
                      <span className="e-tnum">{row.qaText}</span>
                      {row.qaNote ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.qaNote}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per question with the one pill that matters. */}
          <ul className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))] sm:hidden" aria-label="Questions">
            {visible.map((row) => (
              <li key={row.id} className={cn("space-y-1.5 px-4 py-3", row.flagged && tonePhoneBandClass("attention"))}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-[600]">{row.label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.typeLabel} · {row.sub}</p>
                  </div>
                  {row.phonePill ? <EPill tone={row.phonePill.tone}>{row.phonePill.text}</EPill> : null}
                </div>
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  Answered {row.answeredText} · QA issues after {row.qaText}
                </p>
                {row.resultDetail ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.result}: {row.resultDetail}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-4 py-3 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        <p className="min-w-0 flex-1">
          {visible.length} of {rows.length}. Skipped = shown on the submission but left blank; &ldquo;–&rdquo; when that cannot be told (a question asked every few cleans).
          {" "}QA issues after = QA issues on the same job and area after the form was submitted: same job and area, not proof of cause.
          {notPlaced > 0 ? ` ${notPlaced} QA issue${notPlaced === 1 ? "" : "s"} could not be placed in an area and are not counted.` : ""}
          {" "}The tint marks a question skipped often and followed by QA issues. &ldquo;None&rdquo; means none recorded; a form with no submissions says &ldquo;No submissions yet&rdquo;, never 0.
        </p>
        {rows.length > QUESTION_PREVIEW ? (
          <Link href={statsHref({ templateId: data.templateId, weeks: data.weeks, qsort: sort, qall: !showAll })} scroll={false} className="font-[600] text-[hsl(var(--e-primary))] underline">
            {showAll ? "Show fewer" : `Show all ${rows.length}`}
          </Link>
        ) : null}
      </div>
    </ECard>
  );
}

function AreaCard({ data }: { data: FormStatsData }) {
  if (data.locationRollup.size === 0) return null;
  const areas = Array.from(data.locationRollup.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <ECard className="min-w-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-4">
        <h3 className="text-[0.9375rem] font-[600]">By area (location tag)</h3>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">pass = Yes or ticked</span>
      </div>
      <div className="overflow-x-auto border-t border-[hsl(var(--e-border))]">
        <table className="w-full text-left text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <tr>
              <th scope="col" className="px-4 py-2 font-[550]">Area</th>
              <th scope="col" className="px-4 py-2 text-right font-[550]">Questions</th>
              <th scope="col" className="px-4 py-2 text-right font-[550]">Pass rate</th>
              <th scope="col" className="w-1/3 px-4 py-2 max-sm:hidden"><span className="sr-only">Bar</span></th>
            </tr>
          </thead>
          <tbody className="e-tnum divide-y divide-[hsl(var(--e-border))]">
            {areas.map(([tag, entry]) => (
              <tr key={tag}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">{tag}</th>
                <td className="px-4 py-2.5 text-right">{entry.fields}</td>
                <td className="px-4 py-2.5 text-right">{entry.total > 0 ? `${Math.round((entry.pass / entry.total) * 100)}%` : "–"}</td>
                <td className="px-4 py-2.5 max-sm:hidden">{entry.total > 0 ? <EBar value={entry.pass} max={entry.total} tone="primary" /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ECard>
  );
}

export async function FormStatsPanel({
  searchParams,
  canWrite = false,
  timezone = "Australia/Sydney",
  leading,
}: {
  searchParams: FormStatsSearch;
  canWrite?: boolean;
  timezone?: string;
  /** Drawn at the start of the picker row (the Statistics / Submissions chips). */
  leading?: ReactNode;
}) {
  const data = await loadFormStats(searchParams, { timezone });
  const sort = parseQuestionSort(searchParams.qsort);
  const showAll = searchParams.qall === "1";
  const rows = sortQuestionRows(
    buildQuestionRows({
      questions: data.fields.map((meta) => ({ ...meta, ...(data.statsByField.get(meta.id) ?? { answered: 0, shown: null, skipped: null, photoTotal: 0, yesCount: 0, noCount: 0, ratingSum: 0, ratingCount: 0, details: [] }) })),
      parsed: data.parsed,
      weeks: data.weeks,
      qaAfter: qaLookup(data),
    }),
    sort,
  );
  const noSubmissions = data.parsed === 0;
  const photosPerSubmission = noSubmissions ? null : Array.from(data.statsByField.values()).reduce((sum, stat) => sum + stat.photoTotal, 0) / data.parsed;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">{leading}</div>
        <FormStatsControls templates={data.templates} templateId={data.templateId} weeks={data.weeks} weekChoices={STATS_WEEK_CHOICES} />
      </div>

      {!data.template ? (
        <ECard className="border-dashed p-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No form templates yet — create one from the Job forms tab.
        </ECard>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Figure
              label={`Submissions · ${data.weeks} weeks`}
              value={data.parsed.toLocaleString("en-AU")}
              note={noSubmissions ? "No submissions yet" : `from ${data.propertiesUsing} propert${data.propertiesUsing === 1 ? "y" : "ies"}`}
            />
            <Figure
              label="Avg completion time"
              value={noSubmissions ? "–" : formatCompletion(data.completion.avgMinutes)}
              note={noSubmissions ? "No submissions yet" : `clock-on to submit · ${data.completion.notTracked} not tracked`}
            />
            <Figure
              label="Photos per submission"
              value={photosPerSubmission === null ? "–" : photosPerSubmission.toFixed(1)}
              note={noSubmissions ? "No submissions yet" : data.minPhotosAsked !== null ? `form asks for at least ${data.minPhotosAsked}` : "form sets no minimum"}
            />
            <Figure
              label="Skipped answers"
              value={data.skippedPerSubmission === null ? "–" : data.skippedPerSubmission.toFixed(1)}
              note={noSubmissions ? "No submissions yet" : "per submission · shown questions left blank"}
            />
            <Figure
              label={'"No" answers'}
              value={data.noRate === null ? "–" : `${(data.noRate * 100).toFixed(1)}%`}
              note={noSubmissions ? "No submissions yet" : data.noRate === null ? "no yes/no answers" : "of yes/no ticks · sort by Most \"No\""}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <WeeklyChart data={data} />
            <ValidationEnforcementCard canWrite={canWrite} timezone={timezone} />
          </div>

          <QuestionsCard data={data} rows={rows} sort={sort} showAll={showAll} />
          <AreaCard data={data} />
        </>
      )}
    </div>
  );
}
