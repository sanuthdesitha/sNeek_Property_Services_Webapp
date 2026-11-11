/**
 * "Worth knowing this period": rule-based findings from a fixed set of
 * detectors. No generated text: every sentence is a template filled with real
 * numbers, with its basis and a link to the records behind it. Each detector
 * fires when its figure REACHES its threshold (named constants below); the
 * strongest finding of each detector is kept and the strongest MAX_FINDINGS
 * are shown. No finding → the page says "Nothing notable this period".
 *
 * Pure.
 */
import { formatAud, plural } from "./format";
import { invoicesHref, jobsHref, qualityIssuesHref, type DaySpan } from "./links";
import type { HoursFigures, InsightsLink, Measure } from "./types";

/** Property overrun: mean minutes over allocated time, on at least this many cleans. */
export const OVERRUN_MIN_MINUTES = 20;
export const OVERRUN_MIN_CLEANS = 3;
/** Issue category surge: at least this many issues and at least this factor of the previous period. */
export const ISSUE_SURGE_MIN_COUNT = 5;
export const ISSUE_SURGE_FACTOR = 2;
/** Slow payer: mean days to pay at least this many days beyond terms, on at least this many paid invoices, with an overdue balance. */
export const SLOW_PAY_MIN_DAYS_OVER_TERMS = 7;
export const SLOW_PAY_MIN_INVOICES = 2;
/** Low margin: margin at or below this percentage over at least this many cleans with both sides known. */
export const LOW_MARGIN_MAX_PCT = 15;
export const LOW_MARGIN_MIN_CLEANS = 3;
export const MAX_FINDINGS = 3;

export type DetectorKey = "property_overrun" | "issue_surge" | "slow_payer" | "low_margin";

export type Finding = {
  id: string;
  detector: DetectorKey;
  headline: string;
  detail: string;
  basis: string;
  link: InsightsLink;
  /** Strength relative to the threshold (1 = exactly at threshold). Used to rank. */
  score: number;
};

export type PropertyHoursInput = {
  propertyId: string;
  propertyName: string;
  hours: HoursFigures;
};

export function detectPropertyOverruns(rows: readonly PropertyHoursInput[], span: DaySpan): Finding[] {
  const findings: Finding[] = [];
  for (const row of rows) {
    const basis = row.hours.ratio.basisCount;
    const average = row.hours.averageOverMinutes;
    if (average === null || basis < OVERRUN_MIN_CLEANS || average < OVERRUN_MIN_MINUTES) continue;
    findings.push({
      id: `property_overrun:${row.propertyId}`,
      detector: "property_overrun",
      headline: `${row.propertyName} runs ${average} minutes over its allocated time on average.`,
      detail: `${row.hours.overruns} of ${plural(basis, "clean")} went over.`,
      basis: `Cleans with allocated time and a finished time log${row.hours.ratio.excludedCount ? `; ${row.hours.ratio.excludedCount} excluded` : ""}.`,
      link: { label: "See cleans", href: jobsHref(span, { propertyId: row.propertyId }) },
      score: average / OVERRUN_MIN_MINUTES,
    });
  }
  return findings;
}

export type IssueCategoryInput = { category: string; label: string; current: number; previous: number };

export function detectIssueSurges(rows: readonly IssueCategoryInput[], span: DaySpan, previousLabel: string | null): Finding[] {
  if (previousLabel === null) return [];
  const findings: Finding[] = [];
  for (const row of rows) {
    if (row.current < ISSUE_SURGE_MIN_COUNT || row.current < ISSUE_SURGE_FACTOR * row.previous) continue;
    const verb = row.previous === 0 ? "rose" : row.current === ISSUE_SURGE_FACTOR * row.previous ? "doubled" : "more than doubled";
    findings.push({
      id: `issue_surge:${row.category}`,
      detector: "issue_surge",
      headline: `${row.label} issues ${verb}, from ${row.previous} to ${row.current}.`,
      detail: `QA issues raised this period compared with ${previousLabel}.`,
      basis: "QA issues by the day they were raised.",
      link: { label: "See issues", href: qualityIssuesHref(span, { category: row.category }) },
      score: row.current / Math.max(row.previous, 1) / ISSUE_SURGE_FACTOR,
    });
  }
  return findings;
}

export type ClientPaymentInput = { clientId: string; clientName: string; daysToPay: Measure; overdueAud: number };

export function detectSlowPayers(rows: readonly ClientPaymentInput[], paymentTermsDays: number): Finding[] {
  const findings: Finding[] = [];
  for (const row of rows) {
    const days = row.daysToPay.value;
    if (days === null || row.daysToPay.basisCount < SLOW_PAY_MIN_INVOICES || row.overdueAud <= 0) continue;
    const over = days - paymentTermsDays;
    if (over < SLOW_PAY_MIN_DAYS_OVER_TERMS) continue;
    findings.push({
      id: `slow_payer:${row.clientId}`,
      detector: "slow_payer",
      headline: `${row.clientName} pays ${Math.round(days)} days after invoice on average.`,
      detail: `Terms are ${paymentTermsDays} days. ${formatAud(row.overdueAud)} is overdue now.`,
      basis: `Sent to paid, over ${plural(row.daysToPay.basisCount, "invoice")} paid this period.`,
      link: { label: "See invoices", href: invoicesHref({ clientId: row.clientId, status: "overdue" }) },
      score: over / SLOW_PAY_MIN_DAYS_OVER_TERMS,
    });
  }
  return findings;
}

export type PropertyMarginInput = { propertyId: string; propertyName: string; margin: Measure };

export function detectLowMargins(rows: readonly PropertyMarginInput[], span: DaySpan): Finding[] {
  const findings: Finding[] = [];
  for (const row of rows) {
    const margin = row.margin.value;
    if (margin === null || row.margin.basisCount < LOW_MARGIN_MIN_CLEANS || margin > LOW_MARGIN_MAX_PCT) continue;
    findings.push({
      id: `low_margin:${row.propertyId}`,
      detector: "low_margin",
      headline: `${row.propertyName} made a ${margin}% margin.`,
      detail: `At or below the ${LOW_MARGIN_MAX_PCT}% floor over ${plural(row.margin.basisCount, "clean")}.`,
      basis: "Revenue (invoiced, or the scheduled charge where not yet invoiced) less recorded cleaner pay, over cleans with both.",
      link: { label: "See cleans", href: jobsHref(span, { propertyId: row.propertyId }) },
      score: 1 + (LOW_MARGIN_MAX_PCT - margin) / LOW_MARGIN_MAX_PCT,
    });
  }
  return findings;
}

/** Keep the strongest finding of each detector, then the strongest overall. */
export function pickFindings(all: readonly Finding[], limit: number = MAX_FINDINGS): Finding[] {
  const best = new Map<DetectorKey, Finding>();
  for (const finding of all) {
    const current = best.get(finding.detector);
    if (!current || finding.score > current.score) best.set(finding.detector, finding);
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
