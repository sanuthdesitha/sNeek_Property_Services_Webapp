/**
 * Shared vocabulary for the Quality hub (`/v2/admin/quality`).
 *
 * Pure: imported by the server service, the API routes and the client hub, so
 * the tab keys, filter names and status groups mean the same thing everywhere.
 * The status groups mirror the definitions the accountability overview and the
 * QA issue register already used; they are not new rules.
 */

export const QUALITY_TABS = ["review", "issues", "cleaners", "inspectors", "categories", "coaching"] as const;
export type QualityTab = (typeof QUALITY_TABS)[number];

export const QUALITY_TAB_LABEL: Record<QualityTab, string> = {
  review: "Review queue",
  issues: "Issues",
  cleaners: "Cleaners",
  inspectors: "Inspectors",
  categories: "Categories",
  coaching: "Coaching",
};

export const QUALITY_PERIOD_KEYS = ["7d", "30d", "90d", "custom"] as const;
export type QualityPeriodKey = (typeof QUALITY_PERIOD_KEYS)[number];

export const ISSUE_SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const RECTIFICATION_STATUSES = [
  "PENDING",
  "FIXED_BY_QA",
  "RETURNED_TO_CLEANER",
  "FIXED_BY_OTHER_CLEANER",
  "FIXED_BY_MANAGER",
  "NOT_FIXED",
  "ESCALATED",
] as const;
export type RectificationStatusKey = (typeof RECTIFICATION_STATUSES)[number];

/** A fix is still owed (the accountability overview's OPEN_RECTIFICATION set). */
export const OPEN_RECTIFICATION_STATUSES: readonly RectificationStatusKey[] = [
  "PENDING",
  "RETURNED_TO_CLEANER",
  "NOT_FIXED",
  "ESCALATED",
];

/** Statuses a "Mark fixed" action may record. */
export const FIXED_RECTIFICATION_STATUSES = ["FIXED_BY_MANAGER", "FIXED_BY_QA", "FIXED_BY_OTHER_CLEANER"] as const;
export type FixedRectificationStatus = (typeof FIXED_RECTIFICATION_STATUSES)[number];

export const FALSE_CONFIRMATION_STATUSES = ["NONE", "SUSPECTED", "CONFIRMED", "REJECTED"] as const;
export type FalseConfirmationKey = (typeof FALSE_CONFIRMATION_STATUSES)[number];

/** Auto-proposed accountability bonus sources (lib/accountability/streaks.ts). */
export const BONUS_SOURCES = ["STREAK_5", "STREAK_10", "MONTHLY_RANK_1", "MONTHLY_RANK_2"] as const;

/** Coaching records that are still live (the overview's open set). */
export const OPEN_COACHING_STATUSES = ["OPEN", "ACKNOWLEDGED", "ESCALATED"] as const;

/** Filters shared by every tab. Kept in the URL beside `tab` and the period. */
export type QualityFilters = {
  /** Free text: cleaner, property, job number, category or description. */
  q: string;
  propertyId: string;
  /** Issue category key (settings.accountability.issueCategories). */
  category: string;
  /** Narrow to one cleaner (drill-down from the Cleaners tab, old `cleanerId` links). */
  cleanerId: string;
  /** Narrow to issues one inspector raised (drill-down from the Inspectors tab). */
  raisedById: string;
  /** Only issues whose fix is still owed. */
  openFixes: boolean;
};

/** The Issues tab adds its own status filters on top of the shared ones. */
export type IssueListFilters = QualityFilters & {
  severity: IssueSeverity | "";
  rectificationStatus: RectificationStatusKey | "";
  falseConfirmation: FalseConfirmationKey | "";
};

export const EMPTY_QUALITY_FILTERS: QualityFilters = {
  q: "",
  propertyId: "",
  category: "",
  cleanerId: "",
  raisedById: "",
  openFixes: false,
};

export const EMPTY_ISSUE_FILTERS: IssueListFilters = {
  ...EMPTY_QUALITY_FILTERS,
  severity: "",
  rectificationStatus: "",
  falseConfirmation: "",
};

/** Sort keys each server-sorted table accepts. Anything else is refused (400). */
export const ISSUE_SORTS = ["created", "severity", "category", "rectification", "cleaner", "property"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export const CLEANER_SORTS = ["cleaner", "cleans", "score", "issues", "topCategory", "openFixes", "falseConfirmations", "streak"] as const;
export type CleanerSort = (typeof CLEANER_SORTS)[number];

export const INSPECTOR_SORTS = ["inspector", "inspections", "onSite", "issues", "fixed", "rectificationCost", "flags", "complaintRate"] as const;
export type InspectorSort = (typeof INSPECTOR_SORTS)[number];

export const CATEGORY_SORTS = ["category", "issues", "openFixes"] as const;
export type CategorySort = (typeof CATEGORY_SORTS)[number];

export const INSPECTION_SORTS = ["due", "created", "property"] as const;
export type InspectionSort = (typeof INSPECTION_SORTS)[number];

export function isOpenRectification(status: string): boolean {
  return (OPEN_RECTIFICATION_STATUSES as readonly string[]).includes(status);
}

export function titleCaseKey(value: string | null | undefined): string {
  if (!value) return "–";
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
