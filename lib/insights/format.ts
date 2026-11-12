/**
 * Display formatting shared by the Insights server (finding sentences, CSV)
 * and the page. Formatting only: no arithmetic beyond rounding for display.
 * Pure.
 */
import { EXCLUSION_LABEL, type ExclusionReason, type Measure } from "./types";

const AUD_WHOLE = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const AUD_CENTS = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });

export function formatAud(value: number, cents = false): string {
  return (cents ? AUD_CENTS : AUD_WHOLE).format(value);
}

export function formatPct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function formatHours(value: number): string {
  return value.toFixed(1);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The largest exclusion reason, e.g. "no time log". */
export function mainExclusion(measure: Measure): string | null {
  const entries = (Object.entries(measure.excluded) as Array<[ExclusionReason, number]>).sort((a, b) => b[1] - a[1]);
  return entries.length ? EXCLUSION_LABEL[entries[0][0]] : null;
}

/** "212 of 240 cleans; 28 excluded: no time log (20), no pay rate (8)". */
export function basisText(measure: Measure, noun: { one: string; many: string } = { one: "clean", many: "cleans" }): string {
  const total = measure.basisCount + measure.excludedCount;
  const counted = measure.excludedCount > 0
    ? `${measure.basisCount} of ${total} ${total === 1 ? noun.one : noun.many}`
    : plural(measure.basisCount, noun.one, noun.many);
  if (measure.excludedCount === 0) return counted;
  const reasons = (Object.entries(measure.excluded) as Array<[ExclusionReason, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${EXCLUSION_LABEL[reason]} (${count})`)
    .join(", ");
  return `${counted}; ${measure.excludedCount} excluded: ${reasons}`;
}
