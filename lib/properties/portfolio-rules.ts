/**
 * Pure rules for the Properties list: calendar state, flags, the 30-day QA
 * figure, chip and filter matching, and ordering. No database, no clock read,
 * so every rule is unit-tested on its own.
 */
import { ListQueryError, readQueryValue } from "@/lib/admin/list-query";
import {
  PORTFOLIO_CHIPS,
  QA_MIN_REVIEWED,
  type CalendarState,
  type PortfolioChip,
  type PortfolioFilters,
  type PortfolioFlag,
  type PortfolioRow,
  type PortfolioSort,
  type QaFigure,
} from "./portfolio-options";

export type IntegrationFacts = {
  isEnabled: boolean;
  icalUrl: string | null;
  syncStatus: string;
  syncError: string | null;
  lastSyncAt: Date | null;
} | null;

/** Linked means enabled with a URL; the sync status alone is never "Synced" without both. */
export function calendarStateOf(integration: IntegrationFacts, latestErrorAt: Date | null): CalendarState {
  if (!integration || !integration.isEnabled || !integration.icalUrl?.trim()) return { kind: "not-linked" };
  if (integration.syncStatus === "ERROR") {
    return { kind: "failed", since: latestErrorAt ? latestErrorAt.toISOString() : null, error: integration.syncError };
  }
  if (integration.syncStatus === "SYNCING") return { kind: "syncing" };
  if (integration.syncStatus === "SUCCESS") {
    return { kind: "synced", at: integration.lastSyncAt ? integration.lastSyncAt.toISOString() : null };
  }
  return { kind: "never-synced" };
}

export function isCalendarLinked(state: CalendarState): boolean {
  return state.kind !== "not-linked";
}

export type FlagFacts = {
  calendar: CalendarState;
  keyLostMode: boolean;
  /** Open laundry runs at this property that are overdue or over turnaround. */
  lateLaundryRuns: number;
  /** Open property-care tasks (attached to a job or waiting for one). */
  openCareTasks: number;
  laundryEnabled: boolean;
  laundryTeamSize: number;
};

/** Flags in a fixed order (the order they are listed in the Flags column). */
export function flagsFor(facts: FlagFacts): PortfolioFlag[] {
  const flags: PortfolioFlag[] = [];
  if (facts.calendar.kind === "failed") flags.push("sync-error");
  if (facts.keyLostMode) flags.push("key-lost");
  if (facts.lateLaundryRuns > 0) flags.push("linen-late");
  if (facts.openCareTasks > 0) flags.push("care-due");
  // Laundry off is a decision, not a gap: only flag a laundry property with nobody allocated.
  if (facts.laundryEnabled && facts.laundryTeamSize === 0) flags.push("no-laundry-partner");
  return flags;
}

export function matchesChip(flags: readonly PortfolioFlag[], chip: PortfolioChip | null): boolean {
  if (chip === null) return true;
  if (chip === "attention") return flags.length > 0;
  return flags.includes(chip);
}

/** Average of the authoritative scores, withheld below the minimum sample. */
export function qaFigureOf(scores: readonly number[]): QaFigure {
  const valid = scores.filter((score) => Number.isFinite(score));
  if (valid.length < QA_MIN_REVIEWED) return { score: null, reviewed: valid.length };
  const average = valid.reduce((sum, score) => sum + score, 0) / valid.length;
  return { score: Math.round(average), reviewed: valid.length };
}

export function isOneOffSite(accessInfo: unknown): boolean {
  return (accessInfo as { serviceSite?: unknown } | null)?.serviceSite === true;
}

const CALENDAR_ORDER: Record<CalendarState["kind"], number> = {
  failed: 0,
  syncing: 1,
  "never-synced": 2,
  synced: 3,
  "not-linked": 4,
};

type Comparable = string | number | null;

function sortValue(row: PortfolioRow, sort: PortfolioSort): Comparable {
  switch (sort) {
    case "name":
      return row.name.toLowerCase();
    case "size":
      return row.bedrooms * 100 + row.bathrooms;
    case "calendar":
      return CALENDAR_ORDER[row.calendar.kind];
    case "nextClean":
      return row.nextClean ? `${row.nextClean.dayKey} ${row.nextClean.startTime ?? "99:99"}` : null;
    case "qa":
      return row.qa.score;
    case "flags":
      return row.flags.length;
  }
}

/** Server ordering. Unknown values (no next clean, no QA score) sort last in either direction. */
export function comparePortfolioRows(sort: PortfolioSort, dir: "asc" | "desc") {
  const factor = dir === "asc" ? 1 : -1;
  return (a: PortfolioRow, b: PortfolioRow): number => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    if (left !== null && right !== null && left !== right) {
      return (left < right ? -1 : 1) * factor;
    }
    // Stable tie-break: name, then id.
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  };
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

type QuerySource = URLSearchParams | Record<string, string | string[] | undefined>;

/** Reads the list filters. An unknown chip or a malformed client id is refused (400), not ignored. */
export function parsePortfolioFilters(source: QuerySource): PortfolioFilters {
  const rawChip = readQueryValue(source, "chip");
  if (rawChip !== undefined && !(PORTFOLIO_CHIPS as readonly string[]).includes(rawChip)) {
    throw new ListQueryError(`Unknown filter "${rawChip}".`, "filter");
  }
  const clientId = readQueryValue(source, "clientId") ?? "";
  if (clientId && !ID_PATTERN.test(clientId)) throw new ListQueryError("clientId is not valid.", "filter");
  return {
    q: (readQueryValue(source, "q") ?? "").slice(0, 120),
    clientId,
    suburb: (readQueryValue(source, "suburb") ?? "").slice(0, 120),
    chip: (rawChip as PortfolioChip | undefined) ?? null,
    includeOneOff: readQueryValue(source, "includeOneOff") === "1",
  };
}
