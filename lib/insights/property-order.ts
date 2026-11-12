/**
 * The one ordering of property rows, shared by the Properties tab, its CSV,
 * and the Business tab's five-row preview, so the preview's top five for an
 * order are exactly the first five rows of the full tab in that order.
 *
 * Defaults:
 *  - Properties tab: margin, lowest first, with finance access; name otherwise.
 *  - Business preview: margin, lowest first ("least profitable first"), with
 *    finance access; time over plan, highest first, without it.
 *
 * Financial sort keys are refused (400) without finance access, as on every
 * Insights table. Pure.
 */
import { parseListQuery, type ListQuery } from "@/lib/admin/list-query";
import type { PropertyRow } from "./entities";
import { allowedSorts, PROPERTY_SORTS, propertySortValue, sortRows, type PropertySort } from "./sort";
import type { InsightsAccess } from "./types";

export const PROPERTY_PREVIEW_ROWS = 5;

export type PropertyOrder = { sort: PropertySort; dir: "asc" | "desc" };

export function previewDefaultOrder(access: InsightsAccess): PropertyOrder {
  return access.finance ? { sort: "margin", dir: "asc" } : { sort: "ratio", dir: "desc" };
}

export function tabDefaultOrder(access: InsightsAccess): PropertyOrder {
  return access.finance ? { sort: "margin", dir: "asc" } : { sort: "name", dir: "asc" };
}

/** Strict read of sort / dir / page / pageSize for a property list. */
export function parsePropertyQuery(
  params: URLSearchParams,
  access: InsightsAccess,
  defaults: PropertyOrder = tabDefaultOrder(access),
): ListQuery<PropertySort> {
  return parseListQuery(params, {
    sortable: allowedSorts(PROPERTY_SORTS, access.finance),
    defaultSort: defaults.sort,
    defaultDir: defaults.dir,
  });
}

/** Every row in the order; rows without a value for the column sort last. */
export function orderPropertyRows(rows: readonly PropertyRow[], order: PropertyOrder): PropertyRow[] {
  return sortRows(rows, (row) => propertySortValue(row, order.sort), order.dir, (row) => row.propertyName);
}

/** The preview: the first PROPERTY_PREVIEW_ROWS of the whole set in that order. */
export function previewPropertyRows(rows: readonly PropertyRow[], order: PropertyOrder): PropertyRow[] {
  return orderPropertyRows(rows, order).slice(0, PROPERTY_PREVIEW_ROWS);
}
