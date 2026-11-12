/**
 * Sort keys each Insights table accepts, and the server-side sort. Financial
 * keys are only on the allow-list for viewers with the finance feature, so a
 * sort by margin from someone without it is refused (400), not silently
 * ignored. A row without a value for the sort column always sorts last.
 * Pure.
 */
import type { CleanerRow, ClientRow, PropertyRow } from "./entities";
import type { EntityFigures } from "./types";

const COMMON_SORTS = ["name", "cleans", "planned", "actual", "overruns", "onTime", "qa", "issues", "rework"] as const;
export const PROPERTY_SORTS = [...COMMON_SORTS, "ratio", "revenue", "margin"] as const;
export const CLIENT_SORTS = [...COMMON_SORTS, "revenue", "cost", "margin", "daysToPay", "overdue"] as const;
export const CLEANER_SORTS = COMMON_SORTS;
export const FINANCE_SORTS: readonly string[] = ["revenue", "cost", "margin", "daysToPay", "overdue"];

export type PropertySort = (typeof PROPERTY_SORTS)[number];
export type ClientSort = (typeof CLIENT_SORTS)[number];
export type CleanerSort = (typeof CLEANER_SORTS)[number];
export type AnySort = PropertySort | ClientSort;

export function allowedSorts<T extends string>(all: readonly T[], finance: boolean): T[] {
  return all.filter((key) => finance || !FINANCE_SORTS.includes(key));
}

type SortValue = string | number | null;

function figureValue(figures: EntityFigures, sort: AnySort): SortValue {
  switch (sort) {
    case "cleans":
      return figures.cleans;
    case "planned":
      return figures.hours.plannedHours.value;
    case "actual":
      return figures.hours.actualHours.value;
    case "ratio":
      return figures.hours.ratio.value;
    case "overruns":
      return figures.hours.ratio.basisCount > 0 ? figures.hours.overruns : null;
    case "onTime":
      return figures.onTime.value;
    case "qa":
      return figures.qaScore.value;
    case "issues":
      return figures.issues;
    case "rework":
      return figures.reworkRate.value;
    case "revenue":
      return figures.money?.revenue.value ?? null;
    case "cost":
      return figures.money?.cleanerCost.value ?? null;
    case "margin":
      return figures.money?.margin.value ?? null;
    default:
      return null;
  }
}

export function propertySortValue(row: PropertyRow, sort: PropertySort): SortValue {
  return sort === "name" ? row.propertyName.toLowerCase() : figureValue(row.figures, sort);
}

export function clientSortValue(row: ClientRow, sort: ClientSort): SortValue {
  if (sort === "name") return row.clientName.toLowerCase();
  if (sort === "daysToPay") return row.payment?.daysToPay.value ?? null;
  if (sort === "overdue") return row.payment ? row.payment.overdueAud : null;
  return figureValue(row.figures, sort);
}

export function cleanerSortValue(row: CleanerRow, sort: CleanerSort): SortValue {
  return sort === "name" ? row.name.toLowerCase() : figureValue(row.figures, sort);
}

export function sortRows<T extends { id: string }>(
  rows: readonly T[],
  value: (row: T) => SortValue,
  dir: "asc" | "desc",
  tieName: (row: T) => string,
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return tieName(a).localeCompare(tieName(b));
    if (left === null) return 1;
    if (right === null) return -1;
    if (left < right) return -1 * factor;
    if (left > right) return 1 * factor;
    return tieName(a).localeCompare(tieName(b)) || a.id.localeCompare(b.id);
  });
}
