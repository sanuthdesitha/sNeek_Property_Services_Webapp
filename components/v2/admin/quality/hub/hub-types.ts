/**
 * Payload types the hub reads from /api/admin/quality/*, with light runtime
 * guards (shape only; the server owns the figures).
 */
import type { ListResponse } from "@/lib/admin/list-query";
import type { CleanerRowsResult } from "@/lib/quality/cleaners";
import type { CategoryRowsResult } from "@/lib/quality/categories";
import type { InspectorRowsResult } from "@/lib/quality/inspectors";
import type { InspectionQueueRow } from "@/lib/quality/inspections";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";
import type { QualityOptions } from "@/lib/quality/issue-list";
import type { QualitySummary } from "@/lib/quality/summary";
import type { InspectionSort, IssueSort } from "@/lib/quality/types";
import { hasArray, isRecord } from "./use-quality-read";

export type { CleanerRow } from "@/lib/quality/cleaners";
export type { InspectorRow } from "@/lib/quality/inspectors";
export type { CategorySummary } from "@/lib/quality/groupings";
export type { QualityIssueRow } from "@/lib/quality/issue-rows";
export type { InspectionQueueRow } from "@/lib/quality/inspections";
export type { QualityOptions, QualityOption } from "@/lib/quality/issue-list";

export type SummaryPayload = QualitySummary;
export type CleanersPayload = CleanerRowsResult & {
  /** The period the rows answer (the route always sends it). */
  period?: { key: string; fromKey: string | null; toKey: string; days: number | null };
};
export type InspectorsPayload = InspectorRowsResult;
export type CategoriesPayload = CategoryRowsResult;
export type IssuesPayload = ListResponse<QualityIssueRow, IssueSort>;
export type InspectionsPayload = ListResponse<InspectionQueueRow, InspectionSort>;

export const isSummary = (body: unknown): body is SummaryPayload =>
  isRecord(body) && isRecord(body.cleansReviewed) && isRecord(body.tabs) && isRecord(body.averageScore);
export const isCleaners = (body: unknown): body is CleanersPayload => hasArray(body, "rows");
export const isInspectors = (body: unknown): body is InspectorsPayload => hasArray(body, "rows");
export const isCategories = (body: unknown): body is CategoriesPayload => hasArray(body, "rows");
export const isIssues = (body: unknown): body is IssuesPayload =>
  hasArray(body, "rows") && isRecord(body) && typeof body.total === "number";
export const isInspections = (body: unknown): body is InspectionsPayload =>
  hasArray(body, "rows") && isRecord(body) && typeof body.total === "number";
export const isOptions = (body: unknown): body is QualityOptions =>
  hasArray(body, "cleaners") && hasArray(body, "properties") && hasArray(body, "categories");

/** Server context the page hands the hub. */
export type HubContext = {
  canManage: boolean;
  /** QA inspector acting on the page: Issues tab only, read-only. */
  inspectorView: boolean;
  /**
   * What the Coaching tab may do, decided on the server from the viewer's
   * packs: not visible when its read APIs (coaching records and the cleaner
   * list) would be refused, so the tab is never blank or half-working.
   * Optional: absent means "full" (tests and older callers).
   */
  coaching?: CoachingAccess;
  /** Approve / decline a proposed bonus (payroll pack). Absent = canManage. */
  canDecideBonus?: boolean;
  /**
   * Propose a bonus by hand (ADMIN; OPS_MANAGER with payroll and quality at
   * manage). Absent = canManage (tests and older callers); the server decides.
   */
  canProposeBonus?: boolean;
  timeZone: string;
  falseConfirmationDeduction: number | null;
};

export type CoachingAccess = {
  visible: boolean;
  /** Create and update records (quality manage + cleaner list). */
  canManage: boolean;
  /** The standalone page lives under Workforce; link only when reachable. */
  fullPageLink: boolean;
};
