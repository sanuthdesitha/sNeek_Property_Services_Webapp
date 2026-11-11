/**
 * Reading and writing the Quality hub's shared filters.
 *
 * `parse*Strict` is for API routes: an unknown status value is refused (400).
 * `parse*Lenient` is for the browser URL: an unreadable value is dropped, so a
 * stale bookmark still opens the page. Both use the same parameter names as
 * the old QA issue register (`cleanerId`, `propertyId`, `category`, `severity`,
 * `rectificationStatus`, `falseConfirmation`), so old links keep their meaning.
 *
 * Pure: safe in the browser.
 */
import { QualityQueryError } from "./period";
import {
  EMPTY_ISSUE_FILTERS,
  EMPTY_QUALITY_FILTERS,
  FALSE_CONFIRMATION_STATUSES,
  ISSUE_SEVERITIES,
  RECTIFICATION_STATUSES,
  type IssueListFilters,
  type QualityFilters,
} from "./types";

type QuerySource = URLSearchParams | Record<string, string | string[] | undefined>;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CATEGORY_PATTERN = /^[A-Za-z0-9_\- ]{1,64}$/;

function read(source: QuerySource, key: string): string {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

function readId(source: QuerySource, key: string, strict: boolean): string {
  const value = read(source, key);
  if (!value) return "";
  if (ID_PATTERN.test(value)) return value;
  if (strict) throw new QualityQueryError(`${key} is not a valid id.`);
  return "";
}

function readEnum<T extends string>(source: QuerySource, key: string, allowed: readonly T[], strict: boolean): T | "" {
  const value = read(source, key);
  if (!value) return "";
  if ((allowed as readonly string[]).includes(value)) return value as T;
  if (strict) throw new QualityQueryError(`Unknown ${key} "${value}".`);
  return "";
}

function parseShared(source: QuerySource, strict: boolean): QualityFilters {
  const category = read(source, "category");
  if (category && !CATEGORY_PATTERN.test(category) && strict) {
    throw new QualityQueryError("category is not a valid category key.");
  }
  const openFixes = read(source, "openFixes");
  return {
    q: read(source, "q").slice(0, 100),
    propertyId: readId(source, "propertyId", strict),
    category: category && CATEGORY_PATTERN.test(category) ? category : "",
    cleanerId: readId(source, "cleanerId", strict),
    raisedById: readId(source, "raisedById", strict),
    openFixes: openFixes === "1" || openFixes === "true",
  };
}

function parseIssue(source: QuerySource, strict: boolean): IssueListFilters {
  return {
    ...parseShared(source, strict),
    severity: readEnum(source, "severity", ISSUE_SEVERITIES, strict),
    rectificationStatus: readEnum(source, "rectificationStatus", RECTIFICATION_STATUSES, strict),
    falseConfirmation: readEnum(source, "falseConfirmation", FALSE_CONFIRMATION_STATUSES, strict),
  };
}

export const parseQualityFiltersStrict = (source: QuerySource) => parseShared(source, true);
export const parseQualityFiltersLenient = (source: QuerySource) => parseShared(source, false);
export const parseIssueFiltersStrict = (source: QuerySource) => parseIssue(source, true);
export const parseIssueFiltersLenient = (source: QuerySource) => parseIssue(source, false);

/** Writes the non-empty filters into `params` (removing empty ones). */
export function writeFilters(params: URLSearchParams, filters: Partial<IssueListFilters>): URLSearchParams {
  const merged: IssueListFilters = { ...EMPTY_ISSUE_FILTERS, ...filters };
  const entries: Array<[keyof IssueListFilters, string]> = [
    ["q", merged.q.trim()],
    ["propertyId", merged.propertyId],
    ["category", merged.category],
    ["cleanerId", merged.cleanerId],
    ["raisedById", merged.raisedById],
    ["openFixes", merged.openFixes ? "1" : ""],
    ["severity", merged.severity],
    ["rectificationStatus", merged.rectificationStatus],
    ["falseConfirmation", merged.falseConfirmation],
  ];
  for (const [key, value] of entries) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

/** True when a filter narrows the issue set itself (not just the people). */
export function narrowsIssues(filters: QualityFilters | IssueListFilters): boolean {
  const issueOnly = filters as Partial<IssueListFilters>;
  return Boolean(
    filters.category ||
      filters.openFixes ||
      filters.raisedById ||
      issueOnly.severity ||
      issueOnly.rectificationStatus ||
      issueOnly.falseConfirmation,
  );
}

export function sharedFiltersOnly(filters: IssueListFilters): QualityFilters {
  return {
    q: filters.q,
    propertyId: filters.propertyId,
    category: filters.category,
    cleanerId: filters.cleanerId,
    raisedById: filters.raisedById,
    openFixes: filters.openFixes,
  };
}

export { EMPTY_QUALITY_FILTERS };
