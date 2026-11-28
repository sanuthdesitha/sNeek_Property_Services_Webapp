/**
 * ALL ISSUES REGISTER (pilot "All issues register", 2026-11-28).
 *
 * One list of issues from every existing source, read from the records each
 * source already keeps (no second store): QA inspections (QaIssue), client
 * complaints and office cases (IssueTicket), cleaner reports (cleaner-raised
 * IssueTicket), damage reports (DamageReport), maintenance (PropertyMaintenanceItem),
 * stock (UrgentStockNeed) and automatic flags (SLA cases).
 *
 * This module is PURE (no database, no React): the common row shape, the
 * filters as URL parameters, and the figures for the current filter. The
 * readers live in lib/quality/register/load.ts.
 *
 * Unknown is never zero: a source that could not be loaded is reported as
 * "could not load" beside the figures, a fix time that was not recorded is
 * left out of the average (and counted as such), and an ungraded source has
 * no severity rather than "low".
 */
import { FIX_OVERDUE_MS } from "@/lib/quality/fix-age";

export const REGISTER_SOURCES = [
  "QA_INSPECTION",
  "CLIENT_COMPLAINT",
  "CLEANER_REPORT",
  "DAMAGE",
  "MAINTENANCE",
  "STOCK",
  "AUTOMATIC",
  "OFFICE",
] as const;
export type RegisterSource = (typeof REGISTER_SOURCES)[number];

export const REGISTER_SOURCE_LABEL: Record<RegisterSource, string> = {
  QA_INSPECTION: "QA inspection",
  CLIENT_COMPLAINT: "Client complaint",
  CLEANER_REPORT: "Cleaner report",
  DAMAGE: "Damage",
  MAINTENANCE: "Maintenance",
  STOCK: "Stock",
  AUTOMATIC: "Automatic flag",
  OFFICE: "Office",
};

/** One common scale: IssueTicket's. Each source maps onto it (see load.ts). */
export const REGISTER_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RegisterSeverity = (typeof REGISTER_SEVERITIES)[number];
export const REGISTER_SEVERITY_LABEL: Record<RegisterSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };
const SEVERITY_RANK: Record<RegisterSeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export const REGISTER_STATUSES = ["open", "fixed", "overdue"] as const;
export type RegisterStatusFilter = (typeof REGISTER_STATUSES)[number];
export const REGISTER_STATUS_LABEL: Record<RegisterStatusFilter, string> = { open: "Open", fixed: "Fixed or closed", overdue: "Open over 48 h" };

export const REGISTER_SORTS = ["date", "age", "severity", "property", "source"] as const;
export type RegisterSort = (typeof REGISTER_SORTS)[number];

export type RegisterPerson = { id: string; name: string };

/** The common shape every source is read into. Dates are ISO strings. */
export type RegisterRow = {
  /** `<source>:<record id>`; unique across sources. */
  key: string;
  source: RegisterSource;
  recordId: string;
  /** When the issue was raised or received. */
  date: string;
  title: string;
  detail: string | null;
  propertyId: string | null;
  propertyName: string | null;
  clientId: string | null;
  clientName: string | null;
  cleaners: RegisterPerson[];
  jobId: string | null;
  jobNumber: string | null;
  /** Category key, unique per vocabulary (QA categories are the settings keys). */
  category: string;
  categoryLabel: string;
  /** Null when the source does not grade severity. */
  severity: RegisterSeverity | null;
  /** The source's own word for it ("Major", "Urgent"…). */
  severityLabel: string | null;
  open: boolean;
  /** The source's own status in words. */
  statusLabel: string;
  closedAt: string | null;
  closedBy: string | null;
  /** The record's existing detail page. */
  href: string;
};

export type RegisterSourceState = {
  source: RegisterSource;
  /** ok: read; failed: could not load; hidden: the viewer's permissions do not include it. */
  state: "ok" | "failed" | "hidden";
  /** Rows read for the period (before the non-database filters); null unless ok. */
  read: number | null;
  /** True when the cap was reached: only the newest rows were read. */
  truncated: boolean;
};

export type RegisterFilters = {
  q: string;
  propertyId: string;
  cleanerId: string;
  clientId: string;
  category: string;
  source: RegisterSource | "";
  level: RegisterSeverity | "";
  status: RegisterStatusFilter | "";
};

export const EMPTY_REGISTER_FILTERS: RegisterFilters = { q: "", propertyId: "", cleanerId: "", clientId: "", category: "", source: "", level: "", status: "" };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CATEGORY_PATTERN = /^[A-Za-z0-9_\- ]{1,64}$/;

export class RegisterQueryError extends Error {
  readonly status = 400;
}

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: Source, key: string): string {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

function readPattern(source: Source, key: string, pattern: RegExp, strict: boolean): string {
  const value = read(source, key);
  if (!value || pattern.test(value)) return value;
  if (strict) throw new RegisterQueryError(`${key} is not valid.`);
  return "";
}

function readEnum<T extends string>(source: Source, key: string, allowed: readonly T[], strict: boolean): T | "" {
  const value = read(source, key);
  if (!value) return "";
  if ((allowed as readonly string[]).includes(value)) return value as T;
  if (strict) throw new RegisterQueryError(`Unknown ${key} "${value}".`);
  return "";
}

/**
 * The register's filters from a query. `propertyId`, `cleanerId`, `category`
 * and `q` are the Quality hub's own names (they carry between tabs); the rest
 * are the register's. Strict (API) refuses an unknown value; lenient (the
 * browser URL) drops it.
 */
export function parseRegisterFilters(source: Source, strict: boolean): RegisterFilters {
  return {
    q: read(source, "q").slice(0, 100),
    propertyId: readPattern(source, "propertyId", ID_PATTERN, strict),
    cleanerId: readPattern(source, "cleanerId", ID_PATTERN, strict),
    clientId: readPattern(source, "clientId", ID_PATTERN, strict),
    category: readPattern(source, "category", CATEGORY_PATTERN, strict),
    source: readEnum(source, "source", REGISTER_SOURCES, strict),
    level: readEnum(source, "level", REGISTER_SEVERITIES, strict),
    status: readEnum(source, "status", REGISTER_STATUSES, strict),
  };
}

export function writeRegisterFilters(params: URLSearchParams, filters: RegisterFilters): URLSearchParams {
  for (const key of Object.keys(EMPTY_REGISTER_FILTERS) as Array<keyof RegisterFilters>) {
    const value = String(filters[key] ?? "").trim();
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

export function isOverdue(row: Pick<RegisterRow, "open" | "date">, now: Date): boolean {
  if (!row.open) return false;
  const raised = new Date(row.date).getTime();
  return Number.isFinite(raised) && now.getTime() - raised > FIX_OVERDUE_MS;
}

/** Whole hours since the issue was raised while it is open; null once closed. */
export function openAgeHours(row: Pick<RegisterRow, "open" | "date">, now: Date): number | null {
  if (!row.open) return null;
  const raised = new Date(row.date).getTime();
  if (!Number.isFinite(raised)) return null;
  return Math.floor(Math.max(0, now.getTime() - raised) / 3_600_000);
}

function matchesText(row: RegisterRow, q: string): boolean {
  const needle = q.toLowerCase();
  const haystack = [
    row.title,
    row.detail,
    row.propertyName,
    row.clientName,
    row.jobNumber,
    row.categoryLabel,
    REGISTER_SOURCE_LABEL[row.source],
    ...row.cleaners.map((person) => person.name),
  ];
  return haystack.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

/** The filters the database read does not already apply. */
export function applyRegisterFilters(rows: RegisterRow[], filters: RegisterFilters, now: Date): RegisterRow[] {
  return rows.filter((row) => {
    if (filters.propertyId && row.propertyId !== filters.propertyId) return false;
    if (filters.clientId && row.clientId !== filters.clientId) return false;
    if (filters.cleanerId && !row.cleaners.some((person) => person.id === filters.cleanerId)) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.source && row.source !== filters.source) return false;
    if (filters.level && row.severity !== filters.level) return false;
    if (filters.status === "open" && !row.open) return false;
    if (filters.status === "fixed" && row.open) return false;
    if (filters.status === "overdue" && !isOverdue(row, now)) return false;
    if (filters.q && !matchesText(row, filters.q)) return false;
    return true;
  });
}

export function sortRegisterRows(rows: RegisterRow[], sort: RegisterSort, dir: "asc" | "desc", now: Date): RegisterRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byDate = (a: RegisterRow, b: RegisterRow) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key);
  const compare = (a: RegisterRow, b: RegisterRow): number => {
    switch (sort) {
      case "age":
        return (openAgeHours(a, now) ?? -1) - (openAgeHours(b, now) ?? -1) || byDate(a, b);
      case "severity":
        return (a.severity ? SEVERITY_RANK[a.severity] : 0) - (b.severity ? SEVERITY_RANK[b.severity] : 0) || byDate(a, b);
      case "property":
        return (a.propertyName ?? "").localeCompare(b.propertyName ?? "") || byDate(a, b);
      case "source":
        return REGISTER_SOURCE_LABEL[a.source].localeCompare(REGISTER_SOURCE_LABEL[b.source]) || byDate(a, b);
      default:
        return byDate(a, b);
    }
  };
  return [...rows].sort((a, b) => sign * compare(a, b));
}

// ── Figures ──────────────────────────────────────────────────────────────

export type RegisterCount = { key: string; label: string; total: number; open: number };
export type RegisterRepeat = { kind: "property" | "cleaner"; id: string; name: string; category: string; categoryLabel: string; count: number };
export type RegisterMonth = { month: string; raised: number; closed: number };

export type RegisterStats = {
  total: number;
  open: number;
  overdue: number;
  /** Mean hours from raised to closed over the closed issues whose close time is recorded; null when none. */
  averageFixHours: number | null;
  /** Closed issues counted in the average. */
  fixTimesKnown: number;
  /** Closed issues whose close time was not recorded (left out of the average). */
  fixTimesUnknown: number;
  byCategory: RegisterCount[];
  bySource: RegisterCount[];
  byCleaner: RegisterCount[];
  byProperty: RegisterCount[];
  repeats: RegisterRepeat[];
  months: RegisterMonth[];
};

/** At most this many entries per breakdown (the rest are still in the totals). */
export const REGISTER_BREAKDOWN_MAX = 12;

function tally(rows: RegisterRow[], keysOf: (row: RegisterRow) => Array<{ key: string; label: string }>): RegisterCount[] {
  const counts = new Map<string, RegisterCount>();
  for (const row of rows) {
    for (const { key, label } of keysOf(row)) {
      const entry = counts.get(key) ?? { key, label, total: 0, open: 0 };
      entry.total += 1;
      if (row.open) entry.open += 1;
      counts.set(key, entry);
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, REGISTER_BREAKDOWN_MAX);
}

/** The repeat rule: the same category at the same property, or by the same cleaner, 2+ times in the period. */
export const REPEAT_MIN = 2;

function repeats(rows: RegisterRow[]): RegisterRepeat[] {
  const groups = new Map<string, RegisterRepeat>();
  const add = (kind: RegisterRepeat["kind"], id: string, name: string, row: RegisterRow) => {
    const key = `${kind}|${id}|${row.category}`;
    const entry = groups.get(key) ?? { kind, id, name, category: row.category, categoryLabel: row.categoryLabel, count: 0 };
    entry.count += 1;
    groups.set(key, entry);
  };
  for (const row of rows) {
    if (row.propertyId) add("property", row.propertyId, row.propertyName ?? "Unknown property", row);
    for (const person of row.cleaners) add("cleaner", person.id, person.name, row);
  }
  return Array.from(groups.values())
    .filter((entry) => entry.count >= REPEAT_MIN)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, REGISTER_BREAKDOWN_MAX * 2);
}

/** yyyy-MM of an instant in the organisation's time zone. */
export function monthKeyIn(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
}

function months(rows: RegisterRow[], timeZone: string): RegisterMonth[] {
  const byMonth = new Map<string, RegisterMonth>();
  const entry = (month: string) => {
    const existing = byMonth.get(month) ?? { month, raised: 0, closed: 0 };
    byMonth.set(month, existing);
    return existing;
  };
  for (const row of rows) {
    const raised = monthKeyIn(row.date, timeZone);
    if (raised) entry(raised).raised += 1;
    const closed = row.closedAt ? monthKeyIn(row.closedAt, timeZone) : null;
    if (!row.open && closed) entry(closed).closed += 1;
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export function computeRegisterStats(rows: RegisterRow[], now: Date, timeZone: string): RegisterStats {
  let fixHoursTotal = 0;
  let fixTimesKnown = 0;
  let fixTimesUnknown = 0;
  for (const row of rows) {
    if (row.open) continue;
    const raised = new Date(row.date).getTime();
    const closed = row.closedAt ? new Date(row.closedAt).getTime() : Number.NaN;
    if (Number.isFinite(raised) && Number.isFinite(closed) && closed >= raised) {
      fixHoursTotal += (closed - raised) / 3_600_000;
      fixTimesKnown += 1;
    } else {
      fixTimesUnknown += 1;
    }
  }
  return {
    total: rows.length,
    open: rows.filter((row) => row.open).length,
    overdue: rows.filter((row) => isOverdue(row, now)).length,
    averageFixHours: fixTimesKnown > 0 ? Math.round((fixHoursTotal / fixTimesKnown) * 10) / 10 : null,
    fixTimesKnown,
    fixTimesUnknown,
    byCategory: tally(rows, (row) => [{ key: row.category, label: row.categoryLabel }]),
    bySource: tally(rows, (row) => [{ key: row.source, label: REGISTER_SOURCE_LABEL[row.source] }]),
    byCleaner: tally(rows, (row) => row.cleaners.map((person) => ({ key: person.id, label: person.name }))),
    byProperty: tally(rows, (row) => (row.propertyId ? [{ key: row.propertyId, label: row.propertyName ?? "Unknown property" }] : [])),
    repeats: repeats(rows),
    months: months(rows, timeZone),
  };
}

/** Filter choices from the rows of the period (before the facet filters narrow them). */
export type RegisterFacets = {
  properties: Array<{ id: string; label: string }>;
  cleaners: Array<{ id: string; label: string }>;
  clients: Array<{ id: string; label: string }>;
  categories: Array<{ id: string; label: string }>;
};

export function registerFacets(rows: RegisterRow[]): RegisterFacets {
  const collect = (pairs: Array<[string | null, string | null]>) => {
    const map = new Map<string, string>();
    for (const [id, label] of pairs) if (id) map.set(id, label ?? id);
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  };
  return {
    properties: collect(rows.map((row) => [row.propertyId, row.propertyName])),
    cleaners: collect(rows.flatMap((row) => row.cleaners.map((person) => [person.id, person.name] as [string, string]))),
    clients: collect(rows.map((row) => [row.clientId, row.clientName])),
    categories: collect(rows.map((row) => [row.category, row.categoryLabel])),
  };
}

export type RegisterResponse = {
  rows: Array<RegisterRow & { overdue: boolean; ageHours: number | null }>;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: RegisterSort;
  dir: "asc" | "desc";
  stats: RegisterStats;
  sources: RegisterSourceState[];
  facets: RegisterFacets;
  period: { key: string; fromKey: string | null; toKey: string };
  timeZone: string;
};

/**
 * Which register source a case (IssueTicket) belongs to, or null when it is
 * not an issue the register lists: lost-and-found cases, and the cases a
 * damage report opens per item (the report itself is the Damage row, so
 * listing its cases too would count one fault twice).
 */
export function classifyCase(input: { caseType: string | null; source: string | null }): RegisterSource | null {
  const caseType = (input.caseType ?? "").toUpperCase();
  const source = (input.source ?? "").toUpperCase();
  if (caseType === "LOST_FOUND") return null;
  if (source === "DAMAGE_REPORT") return null;
  if (caseType === "SLA") return "AUTOMATIC";
  if (caseType === "CLIENT_DISPUTE" || source === "CLIENT_PORTAL" || source === "LEGACY_DISPUTE") return "CLIENT_COMPLAINT";
  if (source === "CLEANER_SUBMISSION" || source === "CLEANER_SUBMIT") return "CLEANER_REPORT";
  return "OFFICE";
}

/** Words for a stored key: "CLIENT_DISPUTE" → "Client dispute". */
export function keyWords(value: string | null | undefined): string {
  const words = String(value ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Other";
}
