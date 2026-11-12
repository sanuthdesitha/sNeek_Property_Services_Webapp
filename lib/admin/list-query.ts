/**
 * Shared paging and sorting contract for redesigned admin list routes.
 *
 * Every list that moves to server-side paging reads its query through
 * `parseListQuery`, so page, page size, sort column and direction behave the
 * same everywhere. An unknown sort column or an out-of-range page size is
 * REFUSED with a `ListQueryError` (the route answers 400) rather than quietly
 * replaced by a default: a list that silently ignores what was asked for shows
 * rows in an order nobody chose, and the screen has no way to know.
 */
import { z } from "zod";

export type SortDirection = "asc" | "desc";

export type ListQueryOptions<TSort extends string> = {
  /** The allow-list of sort keys this route accepts. */
  sortable: readonly TSort[];
  defaultSort: TSort;
  defaultDir?: SortDirection;
  defaultPageSize?: number;
  maxPageSize?: number;
};

export type ListQuery<TSort extends string> = {
  page: number;
  pageSize: number;
  sort: TSort;
  dir: SortDirection;
  /** Rows to skip for this page (page - 1) * pageSize. */
  skip: number;
  /** Rows to read for this page (= pageSize). */
  take: number;
};

export type ListResponse<TRow, TSort extends string = string> = {
  rows: TRow[];
  /** The real total matching the filters, not the length of this page. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: TSort;
  dir: SortDirection;
};

/** A malformed list query. Routes turn this into an HTTP 400. */
export class ListQueryError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly field: "page" | "pageSize" | "sort" | "dir" | "filter",
  ) {
    super(message);
    this.name = "ListQueryError";
  }
}

export function isListQueryError(error: unknown): error is ListQueryError {
  return error instanceof ListQueryError;
}

export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100_000;

type QuerySource = URLSearchParams | Record<string, string | string[] | undefined>;

/** Reads one value; blank strings count as absent so `?sort=` means "default". */
export function readQueryValue(source: QuerySource, key: string): string | undefined {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseInteger(
  value: string | undefined,
  field: "page" | "pageSize",
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = z.coerce.number().int().min(min).max(max).safeParse(value);
  if (!/^\d+$/.test(value) || !parsed.success) {
    throw new ListQueryError(`${field} must be a whole number from ${min} to ${max}.`, field);
  }
  return parsed.data;
}

export function parseListQuery<TSort extends string>(
  source: QuerySource,
  options: ListQueryOptions<TSort>,
): ListQuery<TSort> {
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const defaultPageSize = Math.min(options.defaultPageSize ?? DEFAULT_PAGE_SIZE, maxPageSize);

  const page = parseInteger(readQueryValue(source, "page"), "page", 1, 1, MAX_PAGE);
  const pageSize = parseInteger(readQueryValue(source, "pageSize"), "pageSize", defaultPageSize, 1, maxPageSize);

  const rawSort = readQueryValue(source, "sort");
  let sort = options.defaultSort;
  if (rawSort !== undefined) {
    if (!(options.sortable as readonly string[]).includes(rawSort)) {
      throw new ListQueryError(
        `Cannot sort by "${rawSort}". Sortable columns: ${options.sortable.join(", ")}.`,
        "sort",
      );
    }
    sort = rawSort as TSort;
  }

  const rawDir = readQueryValue(source, "dir");
  const dirResult = z.enum(["asc", "desc"]).safeParse(rawDir ?? options.defaultDir ?? "desc");
  if (!dirResult.success) {
    throw new ListQueryError('dir must be "asc" or "desc".', "dir");
  }

  return {
    page,
    pageSize,
    sort,
    dir: dirResult.data,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function listResponse<TRow, TSort extends string>(
  rows: TRow[],
  total: number,
  query: ListQuery<TSort>,
): ListResponse<TRow, TSort> {
  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    sort: query.sort,
    dir: query.dir,
  };
}
