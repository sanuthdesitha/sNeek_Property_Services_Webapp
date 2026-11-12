/**
 * Shared vocabulary for Insights (`/v2/admin/reports`).
 *
 * Pure: imported by the server services, the API routes and the client page,
 * so tab keys, measure shapes and exclusion reasons mean the same thing
 * everywhere.
 *
 * The rule every figure follows: missing data is never zero. A job that lacks
 * an input a figure needs (a client rate, a pay rate, a time log, a start
 * time) is EXCLUDED from that figure and counted, with the reason. A figure
 * supported by fewer than the minimum number of records has no value at all.
 */

export const INSIGHTS_TABS = ["business", "properties", "clients", "cleaners", "time", "pdfs"] as const;
export type InsightsTab = (typeof INSIGHTS_TABS)[number];

export const INSIGHTS_TAB_LABEL: Record<InsightsTab, string> = {
  business: "Business",
  properties: "Properties",
  clients: "Clients",
  cleaners: "Cleaners",
  time: "Time and cost",
  pdfs: "Client report PDFs",
};

/** Tabs with a CSV export of their table. */
export const EXPORTABLE_TABS = ["business", "properties", "clients", "cleaners", "time"] as const;
export type ExportableTab = (typeof EXPORTABLE_TABS)[number];

export const INSIGHTS_PERIOD_KEYS = ["this-month", "last-month", "quarter", "custom"] as const;
export type InsightsPeriodKey = (typeof INSIGHTS_PERIOD_KEYS)[number];

/** Why one record was left out of one figure. */
export const EXCLUSION_REASONS = [
  "no_client_rate",
  "skipped_clean",
  "no_cleaner",
  "no_pay_rate",
  "no_paid_hours",
  "no_planned_time",
  "no_time_log",
  "time_log_open",
  "no_start_time",
  "no_sent_date",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  no_client_rate: "no client rate",
  skipped_clean: "skipped clean, not billed",
  no_cleaner: "no cleaner assigned",
  no_pay_rate: "no pay rate",
  no_paid_hours: "no allocated hours and no time log to pay from",
  no_planned_time: "no allocated time",
  no_time_log: "no time log",
  time_log_open: "time log still running",
  no_start_time: "no start time",
  no_sent_date: "no sent date recorded",
};

export type ExclusionCounts = Partial<Record<ExclusionReason, number>>;

/**
 * One figure. `value` is null when the figure cannot be stated: no supporting
 * records, or fewer than the minimum (`enough` false). `basisCount` records
 * support it; `excludedCount` were left out for the reasons in `excluded`.
 */
export type Measure = {
  value: number | null;
  basisCount: number;
  excludedCount: number;
  excluded: ExclusionCounts;
  enough: boolean;
  /** Plain reason when there is no value, or the main exclusion reason. */
  reason?: string;
};

/** How a change is stated: percent of the previous value, points, or a count. */
export type DeltaKind = "percent" | "points" | "count";

export type MeasureWithDelta = Measure & {
  previous: Measure | null;
  /** Null when either period lacks enough data, or there is no previous period. */
  delta: number | null;
  deltaKind: DeltaKind;
};

export type PeriodPayload = {
  key: InsightsPeriodKey;
  fromKey: string;
  toKey: string;
  days: number;
  label: string;
  previous: { fromKey: string; toKey: string; label: string } | null;
};

export type InsightsAccess = {
  /** Revenue, cleaner cost, margin and days to pay. False → omitted server-side. */
  finance: boolean;
};

/** Hours as planned against hours logged, over jobs that have both. */
export type HoursFigures = {
  plannedHours: Measure;
  actualHours: Measure;
  /** Actual ÷ planned as a percentage, same basis. */
  ratio: Measure;
  /** Jobs whose logged time exceeded planned by more than the tolerance. */
  overruns: number;
  /** Mean (actual − planned) minutes per job on the basis. */
  averageOverMinutes: number | null;
};

/**
 * Revenue split by source, over the cleans the revenue measure counts:
 * invoiced (ex GST, net of credit notes, the fixed record) and not yet
 * invoiced (scheduled charge at current rates).
 */
export type RevenueSplit = {
  invoiced: number;
  invoicedCleans: number;
  notYetInvoiced: number;
  notYetInvoicedCleans: number;
};

/** Money figures; present only for viewers with the finance feature. */
export type MoneyFigures = {
  /** Invoiced revenue plus not-yet-invoiced scheduled charges (see RevenueSplit). */
  revenue: Measure;
  revenueSplit: RevenueSplit;
  cleanerCost: Measure;
  /** Percentage, over jobs where both revenue and cost are known. */
  margin: Measure;
  /**
   * Dollars kept per clean: (revenue − cleaner cost) ÷ cleans, over the same
   * cleans as `margin` (both known). Withheld below the minimum basis.
   */
  marginPerClean: Measure;
};

/** The common measures for one entity (company, property, client, cleaner, job type). */
export type EntityFigures = {
  cleans: number;
  hours: HoursFigures;
  onTime: Measure;
  qaScore: Measure;
  reviewed: number;
  issues: number;
  reworkJobs: number;
  reworkRate: Measure;
  money?: MoneyFigures;
};

export type InsightsLink = { label: string; href: string };
