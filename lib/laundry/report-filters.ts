import { LaundryStatus } from "@prisma/client";
import { z } from "zod";
import type { LaundryDateField, LaundryInvoicePeriod } from "@/lib/laundry/invoice";

/**
 * Shared parsing for the laundry-report filter surface so the preview (GET),
 * PDF download (POST) and email (POST) endpoints all interpret the same inputs
 * identically. Divergence here was the root cause of preview≠email price bugs.
 */

const DATE_FIELDS: LaundryDateField[] = ["scheduled", "confirmed", "pickup", "dropped"];
const STATUS_VALUES = Object.values(LaundryStatus) as LaundryStatus[];

/** Extra filter fields, on top of the base period/date/property/task fields. */
export const reportFilterBodyShape = {
  clientId: z.string().trim().min(1).optional(),
  propertyIds: z.array(z.string().trim().min(1)).max(500).optional(),
  // Accept raw strings and normalize in normalizeReportFilters (uppercase +
  // drop unknowns), matching the GET/preview parser — a nativeEnum here would
  // 400 the whole request on any stray/lowercase token so the surfaces diverge.
  statuses: z.array(z.string()).max(10).optional(),
  dateField: z.enum(["scheduled", "confirmed", "pickup", "dropped"]).optional(),
  groupByProperty: z.boolean().optional(),
};

export interface LaundryReportFilters {
  clientId?: string;
  propertyIds?: string[];
  statuses?: LaundryStatus[];
  dateField?: LaundryDateField;
  groupByProperty?: boolean;
}

/** Parse the extra filter fields from a URLSearchParams (GET/preview). */
export function parseReportFiltersFromSearch(searchParams: URLSearchParams): LaundryReportFilters {
  const filters: LaundryReportFilters = {};

  const clientId = searchParams.get("clientId")?.trim();
  if (clientId) filters.clientId = clientId;

  const propertyIdsRaw = searchParams.get("propertyIds");
  if (propertyIdsRaw) {
    const ids = propertyIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length) filters.propertyIds = ids;
  }

  const statusesRaw = searchParams.get("statuses");
  if (statusesRaw) {
    const statuses = statusesRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is LaundryStatus => STATUS_VALUES.includes(s as LaundryStatus));
    if (statuses.length) filters.statuses = statuses;
  }

  const dateField = searchParams.get("dateField")?.trim();
  if (dateField && DATE_FIELDS.includes(dateField as LaundryDateField)) {
    filters.dateField = dateField as LaundryDateField;
  }

  const groupByProperty = searchParams.get("groupByProperty");
  if (groupByProperty === "true" || groupByProperty === "1") {
    filters.groupByProperty = true;
  }

  return filters;
}

/** Normalize the extra filter fields from a parsed POST body. */
export function normalizeReportFilters(input: {
  clientId?: string;
  propertyIds?: string[];
  statuses?: string[];
  dateField?: LaundryDateField;
  groupByProperty?: boolean;
}): LaundryReportFilters {
  const filters: LaundryReportFilters = {};
  if (input.clientId?.trim()) filters.clientId = input.clientId.trim();
  if (input.propertyIds?.length) {
    const ids = Array.from(new Set(input.propertyIds.map((s) => s.trim()).filter(Boolean)));
    if (ids.length) filters.propertyIds = ids;
  }
  if (input.statuses?.length) {
    // Uppercase + drop unknown tokens — same rule as parseReportFiltersFromSearch.
    const statuses = input.statuses
      .map((s) => String(s).trim().toUpperCase())
      .filter((s): s is LaundryStatus => STATUS_VALUES.includes(s as LaundryStatus));
    if (statuses.length) filters.statuses = statuses;
  }
  if (input.dateField) filters.dateField = input.dateField;
  if (input.groupByProperty) filters.groupByProperty = true;
  return filters;
}

export type { LaundryDateField, LaundryInvoicePeriod };
