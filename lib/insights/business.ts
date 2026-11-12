/**
 * The Business tab: findings, six figure cards with change against the
 * previous period, revenue and cleaner cost by week, and the properties
 * ranked least profitable first.
 *
 * Without the finance feature the money cards, the weekly money chart, the
 * slow-payer and low-margin findings and the margin column are absent from
 * the payload; the properties preview is then ranked by time over plan.
 */
import { weekMondayKey, addDaysToKey } from "@/lib/time/sydney-range";
import { shortDayLabel } from "@/lib/quality/period";
import { roundCents } from "@/lib/finance/job-money";
import { summarise } from "./aggregate";
import { propertyRows, type PropertyRow } from "./entities";
import {
  detectIssueSurges,
  detectLowMargins,
  detectPropertyOverruns,
  detectSlowPayers,
  pickFindings,
  type Finding,
} from "./findings";
import type { JobFact } from "./job-facts";
import { loadCategoryLabelMap, loadIssueCounts, loadJobFacts, type InsightsFilters, type IssueCounts } from "./load-facts";
import { countMeasure, MIN_BASIS_SUMMARY, sum, withDelta } from "./measure";
import { periodPayload, type ClosedRange, type InsightsPeriod } from "./period";
import { clientPayment, loadReceivablesFacts, type ReceivablesFacts } from "./receivables";
import { orderPropertyRows, previewDefaultOrder, PROPERTY_PREVIEW_ROWS, type PropertyOrder } from "./property-order";
import type { EntityFigures, InsightsAccess, MeasureWithDelta, PeriodPayload, RevenueSplit } from "./types";

export { PROPERTY_PREVIEW_ROWS };

export type BusinessCards = {
  revenue?: MeasureWithDelta;
  /** Invoiced vs not yet invoiced, for the revenue card's basis line. */
  revenueSplit?: RevenueSplit;
  margin?: MeasureWithDelta;
  cleans: MeasureWithDelta;
  onTime: MeasureWithDelta;
  hoursRatio: MeasureWithDelta;
  reworkRate: MeasureWithDelta;
};

/** One week of the chart. Values over cleans with both a charge and a cost; null when none. */
export type WeekPoint = {
  weekStart: string;
  label: string;
  revenue: number | null;
  cost: number | null;
  basisCount: number;
  excludedCount: number;
};

export type BusinessPayload = {
  period: PeriodPayload;
  access: InsightsAccess;
  cards: BusinessCards;
  weekly: WeekPoint[] | null;
  /** The first rows in `order` over every property; `rankedBy` names the default order. */
  properties: { rows: PropertyRow[]; total: number; rankedBy: "margin" | "hours"; order: PropertyOrder };
  findings: Finding[];
};

export function businessCards(current: EntityFigures, previous: EntityFigures | null): BusinessCards {
  const cards: BusinessCards = {
    cleans: withDelta(countMeasure(current.cleans), previous ? countMeasure(previous.cleans) : null, "count"),
    onTime: withDelta(current.onTime, previous?.onTime ?? null, "points"),
    hoursRatio: withDelta(current.hours.ratio, previous?.hours.ratio ?? null, "points"),
    reworkRate: withDelta(current.reworkRate, previous?.reworkRate ?? null, "points"),
  };
  if (current.money) {
    cards.revenue = withDelta(current.money.revenue, previous?.money?.revenue ?? null, "percent");
    cards.revenueSplit = current.money.revenueSplit;
    cards.margin = withDelta(current.money.margin, previous?.money?.margin ?? null, "points");
  }
  return cards;
}

/** Monday-start Sydney weeks touching the period; each sums only the period's days. */
export function weeklyMoney(facts: readonly JobFact[], period: ClosedRange): WeekPoint[] {
  const weeks: string[] = [];
  for (let week = weekMondayKey(period.fromKey); week <= period.toKey; week = addDaysToKey(week, 7)) weeks.push(week);
  return weeks.map((weekStart) => {
    const inWeek = facts.filter((fact) => fact.weekKey === weekStart);
    const both = inWeek.filter((fact) => fact.charge.reason === null && fact.cost.reason === null);
    return {
      weekStart,
      label: shortDayLabel(weekStart),
      revenue: both.length ? roundCents(sum(both.map((fact) => fact.charge.value as number))) : null,
      cost: both.length ? roundCents(sum(both.map((fact) => fact.cost.value as number))) : null,
      basisCount: both.length,
      excludedCount: inWeek.length - both.length,
    };
  });
}

function categoryRows(current: IssueCounts, previous: IssueCounts | null, labels: Map<string, string>) {
  if (!previous) return [];
  return Array.from(current.byCategory.entries()).map(([category, count]) => ({
    category,
    label: labels.get(category) ?? category,
    current: count,
    previous: previous.byCategory.get(category) ?? 0,
  }));
}

function slowPayerRows(receivables: ReceivablesFacts) {
  const clientIds = new Set([...receivables.paid.map((row) => row.clientId), ...Array.from(receivables.overdueByClient.keys())]);
  return Array.from(clientIds).map((clientId) => {
    const payment = clientPayment(receivables, clientId);
    return {
      clientId,
      clientName: receivables.clientNames.get(clientId) ?? "Client",
      daysToPay: payment.daysToPay,
      overdueAud: payment.overdueAud,
      termsDays: payment.termsDays,
    };
  });
}

/** The preview's default order over every property (see ./property-order). */
export function rankPropertyPreview(rows: readonly PropertyRow[], finance: boolean): PropertyRow[] {
  return orderPropertyRows(rows, previewDefaultOrder({ finance }));
}

export async function getBusinessInsights(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
  now: Date = new Date(),
): Promise<BusinessPayload> {
  const span = { fromKey: period.fromKey, toKey: period.toKey };
  const [facts, previousFacts, issues, previousIssues, labels, receivables] = await Promise.all([
    loadJobFacts(period, filters),
    period.previous ? loadJobFacts(period.previous, filters) : Promise.resolve(null),
    loadIssueCounts(period, filters),
    period.previous ? loadIssueCounts(period.previous, filters) : Promise.resolve(null),
    loadCategoryLabelMap(),
    access.finance ? loadReceivablesFacts(period, filters, now) : Promise.resolve(null),
  ]);

  const options = { minBasis: MIN_BASIS_SUMMARY, money: access.finance };
  const current = summarise(facts, { ...options, issues: issues.total });
  const previous = previousFacts && previousIssues ? summarise(previousFacts, { ...options, issues: previousIssues.total }) : null;
  const properties = propertyRows(facts, issues, span, access.finance);
  const payload = periodPayload(period);

  const candidates: Finding[] = [
    ...detectPropertyOverruns(
      properties.map((row) => ({
        propertyId: row.id,
        propertyName: row.propertyName,
        hours: row.figures.hours,
        // Absent without finance access (row.figures.money is then not computed).
        marginPerClean: access.finance ? row.figures.money?.marginPerClean : undefined,
      })),
      span,
    ),
    ...detectIssueSurges(categoryRows(issues, previousIssues, labels), span, payload.previous?.label ?? null),
  ];
  if (access.finance) {
    candidates.push(
      ...detectLowMargins(
        properties.flatMap((row) =>
          row.figures.money ? [{ propertyId: row.id, propertyName: row.propertyName, margin: row.figures.money.margin }] : [],
        ),
        span,
      ),
    );
    if (receivables) candidates.push(...detectSlowPayers(slowPayerRows(receivables), receivables.paymentTermsDays));
  }

  return {
    period: payload,
    access,
    cards: businessCards(current, previous),
    weekly: access.finance ? weeklyMoney(facts, period) : null,
    properties: {
      rows: rankPropertyPreview(properties, access.finance).slice(0, PROPERTY_PREVIEW_ROWS),
      total: properties.length,
      rankedBy: access.finance ? "margin" : "hours",
      order: previewDefaultOrder(access),
    },
    findings: pickFindings(candidates),
  };
}
