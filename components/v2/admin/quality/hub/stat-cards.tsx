"use client";

/**
 * The five stat cards above the tabs, as drawn: eyebrow, serif figure on the
 * left, a pill or muted note on the right. A figure without data reads "–"
 * with the reason; the score change only appears when the previous period
 * has reviewed cleans. Each card states its basis in its title.
 */
import * as React from "react";
import { ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { formatMoney } from "../issues/issue-format";
import type { SummaryPayload } from "./hub-types";

type CardProps = {
  label: string;
  value: React.ReactNode;
  aside?: React.ReactNode;
  basis: string;
};

function StatCard({ label, value, aside, basis }: CardProps) {
  return (
    <ECard className="min-w-0 px-4 py-3.5" title={basis}>
      <EEyebrow className="text-[0.65625rem] text-[hsl(var(--e-gold-ink))]">{label}</EEyebrow>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="e-numeral text-[1.75rem] leading-none e-tnum">{value}</span>
        {aside}
      </div>
      <p className="sr-only">{basis}</p>
    </ECard>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{children}</span>;
}

function deltaPill(delta: number | null): React.ReactNode {
  if (delta === null) return <Muted>No earlier data to compare</Muted>;
  const tone: EPillTone = delta > 0 ? "ok" : delta < 0 ? "bad" : "neutral";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return <EPill tone={tone}>{`${sign}${Math.abs(delta)} on last period`}</EPill>;
}

function hoursText(minutes: number | null): string {
  if (minutes === null) return "No rework time recorded";
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} h of rework`;
}

export function QualityStatCards({
  summary,
  loading,
  error,
}: {
  summary: SummaryPayload | null;
  loading: boolean;
  error: string | null;
}) {
  if (!summary) {
    return (
      <section aria-label="Quality figures" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-5 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        {loading ? <span role="status">Loading figures…</span> : <span role="alert">{error ?? "Figures could not be loaded."}</span>}
      </section>
    );
  }

  const { cleansReviewed, averageScore, issuesRaised, fixesOpen, fixCost } = summary;
  return (
    <section aria-label="Quality figures" aria-busy={loading || undefined} className="space-y-2">
      {error ? (
        <p role="alert" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
          Showing the last loaded figures. {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Cleans reviewed"
          value={cleansReviewed.reviewed}
          aside={<Muted>{`of ${cleansReviewed.cleans} clean${cleansReviewed.cleans === 1 ? "" : "s"}`}</Muted>}
          basis="Submitted cleans scheduled in the period that have at least one QA review."
        />
        <StatCard
          label="Average score"
          value={averageScore.value === null ? "–" : Math.round(averageScore.value)}
          aside={averageScore.value === null ? <Muted>Not enough data</Muted> : deltaPill(averageScore.delta)}
          basis="Mean authoritative review score (QA, then admin, then automatic) of the reviewed cleans, compared with the same number of days before."
        />
        <StatCard
          label="Issues raised"
          value={issuesRaised.total}
          aside={issuesRaised.critical > 0 ? <EPill tone="bad">{`${issuesRaised.critical} critical`}</EPill> : <Muted>None critical</Muted>}
          basis="QA issues raised in the period that match the filters."
        />
        <StatCard
          label="Fixes still open"
          value={fixesOpen.open}
          aside={fixesOpen.over48h > 0 ? <EPill tone="warn">{`${fixesOpen.over48h} over 48 h`}</EPill> : <Muted>None over 48 h</Muted>}
          basis="Issues raised in the period whose fix is still owed (pending, returned to the cleaner, not fixed or escalated)."
        />
        <StatCard
          label="Fix cost"
          value={fixCost.amount === null ? "–" : formatMoney(fixCost.amount)}
          aside={<Muted>{fixCost.amount === null ? "No fix cost recorded" : hoursText(fixCost.minutes)}</Muted>}
          basis="QA rectification pay and minutes recorded on issues raised in the period."
        />
      </div>
    </section>
  );
}
