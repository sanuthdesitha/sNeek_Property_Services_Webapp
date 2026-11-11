"use client";

/**
 * The Business tab's "Worth knowing this period" strip and the row of figure
 * cards, as drawn. Each card: eyebrow, serif figure, change pill, and the
 * basis line under it. Money cards are absent for viewers without finance.
 */
import * as React from "react";
import Link from "next/link";
import { ECard, EEyebrow } from "@/components/v2/ui/primitives";
import type { BusinessCards } from "@/lib/insights/business";
import type { Finding } from "@/lib/insights/findings";
import type { MeasureWithDelta, RevenueSplit } from "@/lib/insights/types";
import { BasisLine, DeltaPill, FigureValue, type Direction, type FigureFormat } from "./measure-view";

export function FindingsStrip({ findings }: { findings: Finding[] }) {
  return (
    <section
      aria-labelledby="insights-worth-knowing"
      className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-primary)/0.25)] bg-[hsl(var(--e-primary-soft))] p-4"
    >
      <h2 id="insights-worth-knowing" className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-primary))]">
        Worth knowing this period
      </h2>
      {findings.length === 0 ? (
        <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Nothing notable this period.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {findings.map((finding) => (
            <li key={finding.id} className="min-w-0 space-y-1">
              <p className="text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">{finding.headline}</p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {finding.detail}{" "}
                <Link href={finding.link.href} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
                  {finding.link.label}
                </Link>
              </p>
              <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{finding.basis}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type CardKey = Exclude<keyof BusinessCards, "revenueSplit">;

type CardSpec = {
  key: CardKey;
  label: string;
  format: FigureFormat;
  good: Direction;
  basis: string;
  noun?: { one: string; many: string };
};

const CARD_SPECS: CardSpec[] = [
  { key: "revenue", label: "Revenue", format: "aud", good: "up", basis: "Invoiced amount per clean (ex GST, net of credit notes); cleans not yet invoiced at the current rate card." },
  { key: "margin", label: "Gross margin", format: "pct", good: "up", basis: "(Revenue − cleaner pay) ÷ revenue, over cleans with both." },
  { key: "cleans", label: "Cleans done", format: "count", good: "up", basis: "Submitted, in QA, completed or invoiced cleans scheduled in the period." },
  { key: "onTime", label: "On time", format: "pct", good: "up", basis: "First clock-in within 15 minutes of the scheduled start." },
  { key: "hoursRatio", label: "Actual vs planned hours", format: "pct", good: "down", basis: "Logged hours ÷ allocated hours, over cleans with both." },
  { key: "reworkRate", label: "Rework rate", format: "pct", good: "down", basis: "Rework jobs ÷ cleans." },
];

const audWhole = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

/** "$12,400 invoiced (38 cleans) · $1,250 not yet invoiced (at current rates, 4 cleans)". */
function RevenueSplitLine({ split }: { split: RevenueSplit }) {
  const cleans = (count: number) => `${count} clean${count === 1 ? "" : "s"}`;
  return (
    <p className="text-[0.6875rem] leading-snug text-[hsl(var(--e-text-secondary))]">
      {audWhole.format(split.invoiced)} invoiced ({cleans(split.invoicedCleans)})
      {" · "}
      {audWhole.format(split.notYetInvoiced)} not yet invoiced (at current rates, {cleans(split.notYetInvoicedCleans)})
    </p>
  );
}

function FigureCard({ spec, measure, previousLabel, split }: { spec: CardSpec; measure: MeasureWithDelta; previousLabel: string | null; split?: RevenueSplit }) {
  return (
    <ECard className="flex min-w-0 flex-col gap-1.5 px-4 py-3.5">
      <EEyebrow className="text-[0.65625rem]">{spec.label}</EEyebrow>
      <span className="e-numeral text-[1.625rem] leading-none e-tnum">
        <FigureValue measure={measure} format={spec.format} />
      </span>
      <div>
        <DeltaPill measure={measure} good={spec.good} previousLabel={previousLabel} />
      </div>
      <p className="text-[0.6875rem] leading-snug text-[hsl(var(--e-muted-foreground))]">{spec.basis}</p>
      {split ? <RevenueSplitLine split={split} /> : null}
      {spec.key === "cleans" ? null : <BasisLine measure={measure} noun={spec.noun} />}
    </ECard>
  );
}

export function FigureCards({ cards, previousLabel }: { cards: BusinessCards; previousLabel: string | null }) {
  const shown = CARD_SPECS.filter((spec) => cards[spec.key]);
  return (
    <section aria-label="Figures for the period" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {shown.map((spec) => (
        <FigureCard
          key={spec.key}
          spec={spec}
          measure={cards[spec.key] as MeasureWithDelta}
          previousLabel={previousLabel}
          split={spec.key === "revenue" ? cards.revenueSplit : undefined}
        />
      ))}
    </section>
  );
}
