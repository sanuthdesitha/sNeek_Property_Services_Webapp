"use client";

/**
 * The All issues register's figures for the current filter: four headline
 * cards, the state of each source (could not load / not shown / only the
 * newest rows), and — in a disclosure — the breakdowns, repeat issues and
 * the month-by-month trend. A source that could not load is named next to the
 * figures; it is never counted as zero.
 */
import * as React from "react";
import { BarChart3 } from "lucide-react";
import { ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { OperationsDisclosure } from "@/components/operations/ui";
import { REGISTER_SOURCE_LABEL, type RegisterCount, type RegisterResponse, type RegisterSourceState } from "@/lib/quality/register/model";

function Card({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <ECard className="min-w-0 px-4 py-3.5">
      <EEyebrow className="text-[0.65625rem] text-[hsl(var(--e-gold-ink))]">{label}</EEyebrow>
      <p className="mt-1.5 e-numeral text-[1.75rem] leading-none e-tnum">{value}</p>
      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{note}</p>
    </ECard>
  );
}

function fixText(hours: number | null): string {
  if (hours === null) return "–";
  if (hours < 48) return `${hours} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

function sourceList(states: RegisterSourceState[]): string {
  return states.map((state) => REGISTER_SOURCE_LABEL[state.source]).join(", ");
}

/** Which sources are missing from the figures, and why. */
export function RegisterSourceNotes({ sources }: { sources: RegisterSourceState[] }) {
  const failed = sources.filter((state) => state.state === "failed");
  const hidden = sources.filter((state) => state.state === "hidden");
  const truncated = sources.filter((state) => state.state === "ok" && state.truncated);
  if (failed.length === 0 && hidden.length === 0 && truncated.length === 0) return null;
  return (
    <div className="space-y-1 text-[0.8125rem]">
      {failed.length > 0 ? (
        <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.5)] bg-[hsl(var(--e-warning-soft))] px-3 py-2">
          {`Could not load: ${sourceList(failed)}. Those issues are not in the list or the figures below.`}
        </p>
      ) : null}
      {truncated.length > 0 ? (
        <p className="text-[hsl(var(--e-muted-foreground))]">{`Only the newest 2,000 records of ${sourceList(truncated)} in this period are counted. Shorten the period for the rest.`}</p>
      ) : null}
      {hidden.length > 0 ? (
        <p className="text-[hsl(var(--e-muted-foreground))]">{`Not shown with your permissions: ${sourceList(hidden)}.`}</p>
      ) : null}
    </div>
  );
}

export function RegisterHeadline({ data }: { data: RegisterResponse }) {
  const stats = data.stats;
  const fixNote =
    stats.fixTimesKnown === 0
      ? stats.fixTimesUnknown > 0
        ? `No close time recorded for the ${stats.fixTimesUnknown} closed`
        : "Nothing closed in this filter"
      : `Over ${stats.fixTimesKnown} closed${stats.fixTimesUnknown ? `; ${stats.fixTimesUnknown} without a recorded close time` : ""}`;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card label="Issues" value={stats.total} note="Raised in the period, this filter" />
      <Card label="Open" value={stats.open} note={`${stats.total - stats.open} fixed or closed`} />
      <Card label="Open over 48 h" value={stats.overdue} note="Still open 48 hours after it was raised" />
      <Card label="Average time to fix" value={fixText(stats.averageFixHours)} note={fixNote} />
    </div>
  );
}

function CountList({ title, rows, empty }: { title: string; rows: RegisterCount[]; empty: string }) {
  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="text-[0.8125rem] font-[600]">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{empty}</p>
      ) : (
        <ul className="space-y-1 text-[0.8125rem]">
          {rows.map((row) => (
            <li key={row.key} className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 e-tnum text-[hsl(var(--e-muted-foreground))]">{`${row.total} · ${row.open} open`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1] ?? key} ${year}`;
}

export function RegisterBreakdown({ data }: { data: RegisterResponse }) {
  const stats = data.stats;
  return (
    <OperationsDisclosure title="Breakdown, repeats and trend" description="The same filter, by category, source, cleaner and property, with repeat issues and each month." icon={<BarChart3 />}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountList title="By category" rows={stats.byCategory} empty="No issues." />
        <CountList title="By source" rows={stats.bySource} empty="No issues." />
        <CountList title="By cleaner" rows={stats.byCleaner} empty="No issue names a cleaner." />
        <CountList title="By property" rows={stats.byProperty} empty="No issues." />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 space-y-1.5">
          <h3 className="text-[0.8125rem] font-[600]">Repeat issues</h3>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The same category at one property, or by one cleaner, twice or more in the period.</p>
          {stats.repeats.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No repeats in this filter.</p>
          ) : (
            <ul className="space-y-1 text-[0.8125rem]">
              {stats.repeats.map((repeat) => (
                <li key={`${repeat.kind}-${repeat.id}-${repeat.category}`} className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{`${repeat.name} (${repeat.kind === "property" ? "property" : "cleaner"}) · ${repeat.categoryLabel}`}</span>
                  <span className="shrink-0 e-tnum">{`${repeat.count} times`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="min-w-0 space-y-1.5">
          <h3 className="text-[0.8125rem] font-[600]">Month by month</h3>
          {stats.months.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No issues in the period.</p>
          ) : (
            <table className="w-full text-[0.8125rem]">
              <caption className="sr-only">Issues raised and closed each month ({data.timeZone})</caption>
              <thead>
                <tr className="text-left text-[hsl(var(--e-muted-foreground))]">
                  <th scope="col" className="py-1 font-[500]">Month</th>
                  <th scope="col" className="py-1 text-right font-[500]">Raised</th>
                  <th scope="col" className="py-1 text-right font-[500]">Closed</th>
                </tr>
              </thead>
              <tbody>
                {stats.months.map((month) => (
                  <tr key={month.month} className="border-t border-[hsl(var(--e-border))]">
                    <th scope="row" className="py-1 text-left font-[500]">{monthLabel(month.month)}</th>
                    <td className="py-1 text-right e-tnum">{month.raised}</td>
                    <td className="py-1 text-right e-tnum">{month.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Closed counts only issues raised in the period whose close time is recorded.</p>
        </section>
      </div>
    </OperationsDisclosure>
  );
}
