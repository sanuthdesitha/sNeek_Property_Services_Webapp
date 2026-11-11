"use client";

/**
 * How one Insights figure is shown: the value (or "Not enough data", never a
 * zero), the change pill, and the basis line ("212 of 240 cleans; 28
 * excluded: no time log (28)"). Formatting only.
 */
import * as React from "react";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { basisText, formatAud, formatHours, formatPct } from "@/lib/insights/format";
import type { Measure, MeasureWithDelta } from "@/lib/insights/types";

export type FigureFormat = "aud" | "pct" | "hours" | "count" | "score" | "days";

export const NOT_ENOUGH_TEXT = "Not enough data";

export function formatFigure(value: number, format: FigureFormat): string {
  switch (format) {
    case "aud":
      return formatAud(value);
    case "pct":
      return formatPct(value);
    case "hours":
      return formatHours(value);
    case "score":
      return String(Math.round(value));
    case "days":
      return `${Math.round(value)} d`;
    default:
      return String(value);
  }
}

/** The value, or a muted "Not enough data" with the reason as its title. */
export function FigureValue({ measure, format }: { measure: Measure | undefined; format: FigureFormat }) {
  if (!measure || measure.value === null) {
    return (
      <span className="text-[hsl(var(--e-muted-foreground))]" title={measure?.reason}>
        {NOT_ENOUGH_TEXT}
      </span>
    );
  }
  return <>{formatFigure(measure.value, format)}</>;
}

export type Direction = "up" | "down" | "neutral";

function deltaText(measure: MeasureWithDelta): string {
  const delta = measure.delta ?? 0;
  if (delta === 0) return "no change";
  const sign = delta > 0 ? "+" : "−";
  const size = Math.abs(delta);
  if (measure.deltaKind === "percent") return `${sign}${size}%`;
  if (measure.deltaKind === "points") return `${sign}${size} pts`;
  return `${sign}${size}`;
}

/**
 * Change against the previous period. Colour follows whether the change is
 * good for this figure; the text always carries the sign and unit.
 */
export function DeltaPill({ measure, good, previousLabel }: { measure: MeasureWithDelta; good: Direction; previousLabel: string | null }) {
  if (measure.delta === null) {
    const why = !measure.previous ? "No earlier period to compare" : "No comparable earlier data";
    return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{why}</span>;
  }
  let tone: EPillTone = "neutral";
  if (measure.delta !== 0 && good !== "neutral") {
    const better = good === "up" ? measure.delta > 0 : measure.delta < 0;
    tone = better ? "ok" : "warn";
  }
  return (
    <EPill tone={tone}>
      <span>{deltaText(measure)}</span>
      {previousLabel ? <span className="sr-only">{` compared with ${previousLabel}`}</span> : null}
    </EPill>
  );
}

export function BasisLine({ measure, noun, className }: { measure: Measure; noun?: { one: string; many: string }; className?: string }) {
  return (
    <p className={className ?? "text-[0.6875rem] leading-snug text-[hsl(var(--e-muted-foreground))]"}>{basisText(measure, noun)}</p>
  );
}

/** A table cell value with the basis in the title for a quick check. */
export function CellFigure({ measure, format }: { measure: Measure | undefined; format: FigureFormat }) {
  if (!measure) return <span className="text-[hsl(var(--e-muted-foreground))]">–</span>;
  return (
    <span title={basisText(measure)} className="e-tnum">
      {measure.value === null ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Not enough data</span> : formatFigure(measure.value, format)}
    </span>
  );
}
