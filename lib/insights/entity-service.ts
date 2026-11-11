/**
 * Loads, sorts and pages the Properties, Clients and Cleaners tabs, and
 * builds the Time and cost tab. Rows are computed from the period's facts
 * (bounded by the period) and paged with the shared list-query contract.
 */
import { addDaysToKey, weekMondayKey } from "@/lib/time/sydney-range";
import { shortDayLabel } from "@/lib/quality/period";
import { roundCents } from "@/lib/finance/job-money";
import { listResponse, parseListQuery, type ListResponse } from "@/lib/admin/list-query";
import {
  cleanerRows,
  clientRows,
  jobTypeRows,
  propertyRows,
  type CleanerRow,
  type ClientRow,
  type JobTypeRow,
  type PropertyRow,
} from "./entities";
import type { JobFact } from "./job-facts";
import { loadIssueCounts, loadJobFacts, loadPeopleNames, type InsightsFilters } from "./load-facts";
import { sum, tally } from "./measure";
import { periodPayload, type ClosedRange, type InsightsPeriod } from "./period";
import { loadReceivablesFacts } from "./receivables";
import {
  allowedSorts,
  CLEANER_SORTS,
  CLIENT_SORTS,
  PROPERTY_SORTS,
  cleanerSortValue,
  clientSortValue,
  propertySortValue,
  sortRows,
} from "./sort";
import type { InsightsAccess, PeriodPayload } from "./types";

type QuerySource = URLSearchParams;

export type EntityPage<TRow> = ListResponse<TRow> & { period: PeriodPayload; access: InsightsAccess };

function span(period: InsightsPeriod) {
  return { fromKey: period.fromKey, toKey: period.toKey };
}

function page<TRow>(rows: TRow[], query: ReturnType<typeof parseListQuery>, period: InsightsPeriod, access: InsightsAccess): EntityPage<TRow> {
  const slice = rows.slice(query.skip, query.skip + query.take);
  return { ...listResponse(slice, rows.length, query), period: periodPayload(period), access };
}

type Sorted<TRow> = { rows: TRow[]; query: ReturnType<typeof parseListQuery> };

export async function sortedPropertyRows(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
  params: QuerySource,
): Promise<Sorted<PropertyRow>> {
  const sortable = allowedSorts(PROPERTY_SORTS, access.finance);
  const query = parseListQuery(params, { sortable, defaultSort: access.finance ? "margin" : "name", defaultDir: "asc" });
  const [facts, issues] = await Promise.all([loadJobFacts(period, filters), loadIssueCounts(period, filters)]);
  const rows = propertyRows(facts, issues, span(period), access.finance);
  return { rows: sortRows(rows, (row) => propertySortValue(row, query.sort), query.dir, (row) => row.propertyName), query };
}

export async function sortedClientRows(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
  params: QuerySource,
  now: Date = new Date(),
): Promise<Sorted<ClientRow>> {
  const sortable = allowedSorts(CLIENT_SORTS, access.finance);
  const query = parseListQuery(params, { sortable, defaultSort: "name", defaultDir: "asc" });
  const [facts, issues, receivables] = await Promise.all([
    loadJobFacts(period, filters),
    loadIssueCounts(period, filters),
    access.finance ? loadReceivablesFacts(period, filters, now) : Promise.resolve(null),
  ]);
  const rows = clientRows(facts, issues, receivables, span(period));
  return { rows: sortRows(rows, (row) => clientSortValue(row, query.sort), query.dir, (row) => row.clientName), query };
}

export async function sortedCleanerRows(
  period: InsightsPeriod,
  filters: InsightsFilters,
  params: QuerySource,
): Promise<Sorted<CleanerRow>> {
  const query = parseListQuery(params, { sortable: CLEANER_SORTS, defaultSort: "name", defaultDir: "asc" });
  const [facts, issues] = await Promise.all([loadJobFacts(period, filters), loadIssueCounts(period, filters)]);
  const ids = new Set<string>(Array.from(issues.byCleaner.keys()));
  for (const fact of facts) for (const share of fact.shares) ids.add(share.cleanerId);
  const names = await loadPeopleNames(Array.from(ids));
  const rows = cleanerRows(facts, issues, names, span(period));
  return { rows: sortRows(rows, (row) => cleanerSortValue(row, query.sort), query.dir, (row) => row.name), query };
}

export async function getPropertyInsights(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
  params: QuerySource,
): Promise<EntityPage<PropertyRow>> {
  const { rows, query } = await sortedPropertyRows(period, filters, access, params);
  return page(rows, query, period, access);
}

export async function getClientInsights(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
  params: QuerySource,
  now: Date = new Date(),
): Promise<EntityPage<ClientRow>> {
  const { rows, query } = await sortedClientRows(period, filters, access, params, now);
  return page(rows, query, period, access);
}

export async function getCleanerInsights(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
  params: QuerySource,
): Promise<EntityPage<CleanerRow>> {
  const { rows, query } = await sortedCleanerRows(period, filters, params);
  return page(rows, query, period, access);
}

/** Cleaner cost of one week: recorded pay over cleans with a known cost. */
export type WeekCost = { weekStart: string; label: string; cost: number | null; basisCount: number; excludedCount: number };

export function weeklyCost(facts: readonly JobFact[], period: ClosedRange): WeekCost[] {
  const weeks: string[] = [];
  for (let week = weekMondayKey(period.fromKey); week <= period.toKey; week = addDaysToKey(week, 7)) weeks.push(week);
  return weeks.map((weekStart) => {
    const result = tally(facts.filter((fact) => fact.weekKey === weekStart).map((fact) => fact.cost));
    return {
      weekStart,
      label: shortDayLabel(weekStart),
      cost: result.values.length ? roundCents(sum(result.values)) : null,
      basisCount: result.values.length,
      excludedCount: result.excludedCount,
    };
  });
}

/** Properties shown on Time and cost: most time over plan first. */
export const TIME_PROPERTY_ROWS = 25;

export type TimeCostPayload = {
  period: PeriodPayload;
  access: InsightsAccess;
  byJobType: JobTypeRow[];
  byProperty: { rows: PropertyRow[]; total: number };
  weeklyCost: WeekCost[] | null;
};

export async function getTimeCostInsights(
  period: InsightsPeriod,
  filters: InsightsFilters,
  access: InsightsAccess,
): Promise<TimeCostPayload> {
  const [facts, issues] = await Promise.all([loadJobFacts(period, filters), loadIssueCounts(period, filters)]);
  const properties = propertyRows(facts, issues, span(period), access.finance);
  const ranked = sortRows(properties, (row) => row.figures.hours.ratio.value, "desc", (row) => row.propertyName);
  return {
    period: periodPayload(period),
    access,
    byJobType: jobTypeRows(facts, span(period), access.finance),
    byProperty: { rows: ranked.slice(0, TIME_PROPERTY_ROWS), total: properties.length },
    weeklyCost: access.finance ? weeklyCost(facts, period) : null,
  };
}
