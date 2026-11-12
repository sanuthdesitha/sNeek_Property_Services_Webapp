/**
 * Properties list (portfolio) contract shared by the server list, the CSV
 * export, the bulk endpoint and the screen. Plain module (no "use client"), so
 * server components may read these constants.
 */
import type { ListResponse } from "@/lib/admin/list-query";

export const PORTFOLIO_SORTS = ["name", "size", "calendar", "nextClean", "qa", "flags"] as const;
export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];

/** Flags shown in the Flags column. Each comes from existing data only. */
export const PORTFOLIO_FLAGS = ["sync-error", "key-lost", "linen-late", "care-due", "no-laundry-partner"] as const;
export type PortfolioFlag = (typeof PORTFOLIO_FLAGS)[number];

export const PORTFOLIO_FLAG_LABEL: Record<PortfolioFlag, string> = {
  "sync-error": "Sync error",
  "key-lost": "Key lost",
  "linen-late": "Linen late",
  "care-due": "Care due",
  "no-laundry-partner": "No laundry",
};

/** The filter chips as drawn. "attention" is any flag. */
export const PORTFOLIO_CHIPS = ["attention", "sync-error", "key-lost", "no-laundry-partner"] as const;
export type PortfolioChip = (typeof PORTFOLIO_CHIPS)[number];

export const PORTFOLIO_CHIP_LABEL: Record<PortfolioChip, string> = {
  attention: "Needs attention",
  "sync-error": "Sync error",
  "key-lost": "Key lost",
  "no-laundry-partner": "No laundry partner",
};

export const PORTFOLIO_VIEWS = ["list", "cards", "map"] as const;
export type PortfolioViewMode = (typeof PORTFOLIO_VIEWS)[number];

/** Fewer reviewed cleans than this in 30 days shows "Not enough data", never a score. */
export const QA_MIN_REVIEWED = 3;
export const QA_WINDOW_DAYS = 30;

export type CalendarState =
  | { kind: "not-linked" }
  | { kind: "never-synced" }
  | { kind: "syncing" }
  | { kind: "synced"; at: string | null }
  | { kind: "failed"; since: string | null; error: string | null };

export type NextClean = {
  jobId: string;
  jobNumber: string;
  /** Sydney calendar day, yyyy-MM-dd. */
  dayKey: string;
  startTime: string | null;
  status: string;
};

/** QA over the last 30 days: a score only with enough reviewed cleans. */
export type QaFigure = { score: number | null; reviewed: number };

export type PortfolioRow = {
  id: string;
  name: string;
  suburb: string;
  address: string;
  clientId: string;
  clientName: string;
  bedrooms: number;
  bathrooms: number;
  imageUrl: string | null;
  oneOff: boolean;
  hasCoords: boolean;
  jobCount: number;
  calendar: CalendarState;
  nextClean: NextClean | null;
  qa: QaFigure;
  flags: PortfolioFlag[];
};

export type PortfolioFilters = {
  q: string;
  clientId: string;
  suburb: string;
  chip: PortfolioChip | null;
  includeOneOff: boolean;
};

export type PortfolioStats = {
  active: number;
  clients: number;
  calendarLinked: number;
  syncErrors: number;
  cleansNext7Days: number;
  unassignedNext7Days: number;
  jobsAllTime: number;
  needsAttention: number;
};

export type PortfolioListResponse = ListResponse<PortfolioRow, PortfolioSort> & {
  counts: Record<PortfolioChip, number> & { oneOff: number };
  stats: PortfolioStats;
  facets: { clients: Array<{ id: string; name: string }>; suburbs: string[] };
  /** Properties with a map position in the current filter set (Map view). */
  mapped: number;
};

export function sizeLabel(bedrooms: number, bathrooms: number): string {
  const beds = bedrooms <= 0 ? "Studio" : `${bedrooms} bd`;
  return bathrooms > 0 ? `${beds} · ${bathrooms} ba` : beds;
}
