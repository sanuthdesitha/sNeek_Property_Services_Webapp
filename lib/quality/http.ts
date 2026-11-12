/**
 * Request plumbing shared by the /api/admin/quality/* routes: read the period
 * and filters strictly, and map errors to honest status codes.
 */
import { NextResponse } from "next/server";
import { isListQueryError, readQueryValue } from "@/lib/admin/list-query";
import { parseIssueFiltersStrict, parseQualityFiltersStrict } from "./filters";
import { isQualityQueryError, resolveQualityPeriod, type QualityPeriod } from "./period";
import type { IssueListFilters, QualityFilters } from "./types";

export type HubQuery = { period: QualityPeriod; filters: QualityFilters };
export type IssueHubQuery = { period: QualityPeriod; filters: IssueListFilters };

function readPeriod(params: URLSearchParams, now: Date): QualityPeriod {
  return resolveQualityPeriod(
    { period: readQueryValue(params, "period"), from: readQueryValue(params, "from"), to: readQueryValue(params, "to") },
    now,
  );
}

export function readHubQuery(params: URLSearchParams, now: Date = new Date()): HubQuery {
  return { period: readPeriod(params, now), filters: parseQualityFiltersStrict(params) };
}

export function readIssueHubQuery(params: URLSearchParams, now: Date = new Date()): IssueHubQuery {
  return { period: readPeriod(params, now), filters: parseIssueFiltersStrict(params) };
}

/** Optional `sort`/`dir` for the small, fully loaded tables. */
export function readSort<T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
  fallback: T,
  fallbackDir: "asc" | "desc" = "desc",
): { sort: T; dir: "asc" | "desc" } {
  const sort = readQueryValue(params, "sort");
  const dir = readQueryValue(params, "dir");
  if (sort !== undefined && !(allowed as readonly string[]).includes(sort)) {
    throw new HubSortError(`Cannot sort by "${sort}". Sortable columns: ${allowed.join(", ")}.`);
  }
  if (dir !== undefined && dir !== "asc" && dir !== "desc") throw new HubSortError('dir must be "asc" or "desc".');
  return { sort: (sort as T | undefined) ?? fallback, dir: (dir as "asc" | "desc" | undefined) ?? fallbackDir };
}

export class HubSortError extends Error {
  readonly status = 400;
}

export function hubErrorResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error && error.message ? error.message : fallback;
  if (isQualityQueryError(error) || isListQueryError(error) || error instanceof HubSortError) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** The period as the client sees it (no Date objects). */
export function periodPayload(period: QualityPeriod) {
  return {
    key: period.key,
    fromKey: period.fromKey,
    toKey: period.toKey,
    days: period.days,
    previous: period.previous ? { fromKey: period.previous.fromKey, toKey: period.previous.toKey } : null,
  };
}
