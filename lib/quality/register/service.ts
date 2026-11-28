import "server-only";
/**
 * The All issues register as the route answers it: read the sources the
 * viewer may see for the period, apply the filters, compute the figures over
 * every matching row and return one page (server-side paging).
 */
import { getAppSettings } from "@/lib/settings";
import { toCsv } from "@/lib/insights/csv";
import type { ListQuery } from "@/lib/admin/list-query";
import type { QualityPeriod } from "@/lib/quality/period";
import { readRegister } from "./load";
import {
  REGISTER_SEVERITY_LABEL,
  REGISTER_SOURCE_LABEL,
  applyRegisterFilters,
  computeRegisterStats,
  isOverdue,
  openAgeHours,
  registerFacets,
  sortRegisterRows,
  type RegisterFilters,
  type RegisterResponse,
  type RegisterRow,
  type RegisterSort,
  type RegisterSource,
} from "./model";

export type RegisterRequest = {
  period: QualityPeriod;
  filters: RegisterFilters;
  allowed: ReadonlySet<RegisterSource>;
  now?: Date;
};

async function organisationTimeZone(): Promise<string> {
  const settings = await getAppSettings().catch(() => null);
  return settings?.timezone || "Australia/Sydney";
}

async function matchingRows(request: RegisterRequest) {
  const now = request.now ?? new Date();
  const read = await readRegister({ range: request.period, propertyId: request.filters.propertyId || null, allowed: request.allowed });
  // Facets come from the period's rows with only the property applied (it is the database filter).
  const facets = registerFacets(read.rows);
  const rows = applyRegisterFilters(read.rows, request.filters, now);
  return { now, rows, facets, sources: read.sources };
}

export async function buildRegisterResponse(request: RegisterRequest, query: ListQuery<RegisterSort>): Promise<RegisterResponse> {
  const [{ now, rows, facets, sources }, timeZone] = await Promise.all([matchingRows(request), organisationTimeZone()]);
  const sorted = sortRegisterRows(rows, query.sort, query.dir, now);
  const page = sorted.slice(query.skip, query.skip + query.take);
  return {
    rows: page.map((row) => ({ ...row, overdue: isOverdue(row, now), ageHours: openAgeHours(row, now) })),
    total: rows.length,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(rows.length / query.pageSize)),
    sort: query.sort,
    dir: query.dir,
    stats: computeRegisterStats(rows, now, timeZone),
    sources,
    facets,
    period: { key: request.period.key, fromKey: request.period.fromKey, toKey: request.period.toKey },
    timeZone,
  };
}

function formatInstant(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export type RegisterCsv = { csv: string; skippedSources: string[] };

/** CSV of every matching row. Sources that could not load are named in a last line, never silently missing. */
export async function buildRegisterCsv(request: RegisterRequest, sort: RegisterSort, dir: "asc" | "desc"): Promise<RegisterCsv> {
  const [{ now, rows, sources }, timeZone] = await Promise.all([matchingRows(request), organisationTimeZone()]);
  const sorted: RegisterRow[] = sortRegisterRows(rows, sort, dir, now);
  const header = ["Date", "Source", "Property", "Client", "Cleaners", "Job", "Category", "Severity", "Status", "Open", "Over 48 h", "Age (h)", "Closed", "Closed by", "Title", "Link"];
  const body = sorted.map((row) => [
    formatInstant(row.date, timeZone),
    REGISTER_SOURCE_LABEL[row.source],
    row.propertyName,
    row.clientName,
    row.cleaners.map((person) => person.name).join("; "),
    row.jobNumber,
    row.categoryLabel,
    row.severity ? REGISTER_SEVERITY_LABEL[row.severity] : "Not graded",
    row.statusLabel,
    row.open ? "Yes" : "No",
    isOverdue(row, now) ? "Yes" : "No",
    openAgeHours(row, now),
    row.open ? "" : row.closedAt ? formatInstant(row.closedAt, timeZone) : "Not recorded",
    row.closedBy,
    row.title,
    row.href,
  ]);
  const skippedSources = sources.filter((state) => state.state === "failed").map((state) => REGISTER_SOURCE_LABEL[state.source]);
  const notes = skippedSources.length ? [[`Could not load: ${skippedSources.join(", ")}. Those issues are not in this file.`]] : [];
  return { csv: toCsv(header, [...body, ...notes]), skippedSources };
}
