/**
 * Shapes shared by the forms library list route and its screen. Client-safe:
 * no Prisma, no server imports.
 */
import type { TemplateCheckResult } from "./template-checks";

export const FORM_LIBRARY_SORTS = ["name", "status", "usedBy", "questions", "avgTime", "completion", "checks", "changed"] as const;
export type FormLibrarySort = (typeof FORM_LIBRARY_SORTS)[number];

/** The left panel: everything not archived, unpublished changes, or archived. */
export const FORM_LIBRARY_SCOPES = ["active", "drafts", "archived"] as const;
export type FormLibraryScope = (typeof FORM_LIBRARY_SCOPES)[number];

export const FORM_LIBRARY_STATUSES = ["any", "live", "live-draft", "draft"] as const;
export type FormLibraryStatusFilter = (typeof FORM_LIBRARY_STATUSES)[number];

export const FORM_LIBRARY_USED_BY = ["any", "default", "property", "job", "unused"] as const;
export type FormLibraryUsedByFilter = (typeof FORM_LIBRARY_USED_BY)[number];

export type FormLibraryFilters = {
  scope: FormLibraryScope;
  /** A group id, "none" for ungrouped, or "" for every group. */
  group: string;
  tag: string;
  status: FormLibraryStatusFilter;
  usedBy: FormLibraryUsedByFilter;
  problems: boolean;
  q: string;
};

/** live: published, nothing pending. live-draft: published with unpublished changes. */
export type FormLibraryStatus = "live" | "live-draft" | "draft" | "archived";

/** How jobs reach this form (resolved with the runtime rules). */
export type FormUsage =
  | { kind: "default"; properties: number }
  | { kind: "property"; properties: number }
  | { kind: "job" }
  | { kind: "unused" }
  | { kind: "not-live" };

export type FormLibraryRow = {
  id: string;
  name: string;
  serviceType: string;
  kind: string;
  version: number;
  status: FormLibraryStatus;
  /** Base version of the pending draft, when there is one. */
  draftBaseVersion: number | null;
  usage: FormUsage;
  questions: number;
  /** Minutes; null = too little data (shown as "–"). */
  avgMinutes: number | null;
  /** 0–100; null = too little data (shown as "–"). */
  completionPct: number | null;
  submissionsInWindow: number;
  /**
   * Validator errors and warnings, plus the usage check's "never answered"
   * questions folded in as warnings (rule "never-answered") when the usage
   * check ran for this row (see FormLibraryPayload.checksBasis).
   */
  checks: TemplateCheckResult;
  /** Required questions never answered in recent submissions (usage check). */
  neverAnswered: Array<{ id: string; label: string }>;
  usageSample: number;
  groupId: string | null;
  tags: string[];
  /** Last change to the live row or its draft. */
  changedAt: string;
};

export type FormLibraryCounts = {
  /** Not archived. */
  active: number;
  drafts: number;
  archived: number;
  /** Forms with check errors or warnings (incl. "never answered" when the usage check ran) within the current filters. */
  problems: number;
  /** Non-archived forms per group id ("none" = ungrouped). */
  byGroup: Record<string, number>;
  tags: Array<{ tag: string; count: number }>;
};

export type FormLibraryPayload = {
  rows: FormLibraryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: FormLibrarySort;
  dir: "asc" | "desc";
  counts: FormLibraryCounts;
  /** Basis of Avg time / Completion, for the column hints. */
  statsBasis: { weeks: number; minSample: number };
  /** Organisation timezone for formatting "Changed". */
  timezone: string;
  /**
   * Where the usage check ("never answered") and the figures were computed:
   * "all" = every form in the filters (so Has problems, its count and the
   * Avg time / Completion sorts cover the whole set); "page" = only the rows
   * shown, because the filtered set had more submissions than the library
   * reads at once (Has problems then counts validator checks only).
   */
  checksBasis: "all" | "page";
};

/** A library group (folder) with its count of forms that are not archived. */
export type FormGroupSummary = {
  id: string;
  name: string;
  sortOrder: number;
  formCount: number;
};
