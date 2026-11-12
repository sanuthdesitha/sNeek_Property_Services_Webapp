/**
 * Destination links for Command. Each one lands on a page already filtered to
 * what the row or tile counts, using that page's existing URL parameters:
 * Jobs (`statusChip`, `dateFrom`, `dateTo`; see lib/jobs/workspace-state),
 * Invoices (`tab=invoices&status=`; see use-invoice-list), the Quality hub
 * (`tab=review`), Cases (`queue=open`, `open=<caseId>`, from the Cases step
 * built in parallel). Pages with no selection parameter today (Approvals,
 * Lost and found) get their plain list; noted for their redesign steps.
 */
import { addDaysToKey } from "@/lib/time/sydney-range";

export function jobsNeedingCleanerHref(fromKey: string, toKey?: string): string {
  const params = new URLSearchParams({ statusChip: "UNASSIGNED", dateFrom: fromKey });
  if (toKey) params.set("dateTo", toKey);
  return `/v2/admin/jobs?${params.toString()}`;
}

/** Unassigned jobs today and tomorrow (the "next 48 h" tile and rows). */
export function unassignedSoonHref(todayKey: string): string {
  return jobsNeedingCleanerHref(todayKey, addDaysToKey(todayKey, 1));
}

/** Unassigned jobs of any date: the status filter alone. */
export const UNASSIGNED_ANY_HREF = "/v2/admin/jobs?statusChip=UNASSIGNED";

export function jobsByStatusTodayHref(status: string, todayKey: string): string {
  const params = new URLSearchParams({ statusChip: status, dateFrom: todayKey, dateTo: todayKey });
  return `/v2/admin/jobs?${params.toString()}`;
}

/** The Jobs "Today" built-in view (same rows the old dispatch table showed, uncapped). */
export const JOBS_TODAY_HREF = "/v2/admin/jobs?dateScope=today";

export function jobHref(jobId: string): string {
  return `/v2/admin/jobs/${encodeURIComponent(jobId)}`;
}

export function jobTabHref(jobId: string, tab: string): string {
  return `${jobHref(jobId)}?tab=${encodeURIComponent(tab)}`;
}

export const QUALITY_REVIEW_HREF = "/v2/admin/quality?tab=review";
export const INVOICES_NEEDS_ACTION_HREF = "/v2/admin/finance?tab=invoices&status=needs-action";
export const INVOICES_DRAFT_HREF = "/v2/admin/finance?tab=invoices&status=DRAFT";
export const INVOICES_OVERDUE_HREF = "/v2/admin/finance?tab=invoices&status=overdue";
export const INVOICES_SENT_HREF = "/v2/admin/finance?tab=invoices&status=SENT";
export const PAY_REQUESTS_HREF = "/v2/admin/finance?tab=adjustments";
export const PAYROLL_HREF = "/v2/admin/finance?tab=payroll";
export const APPROVALS_HREF = "/v2/admin/approvals";
export const CASES_HREF = "/v2/admin/cases?queue=open";

export function caseHref(caseId: string): string {
  return `/v2/admin/cases?open=${encodeURIComponent(caseId)}`;
}
export const LAUNDRY_HREF = "/v2/admin/laundry";
export const LOST_FOUND_HREF = "/v2/admin/lost-found";
export const INVENTORY_HREF = "/v2/admin/inventory";
export const QUOTES_HREF = "/v2/admin/quotes";
export const LIVE_OPS_HREF = "/v2/admin/ops";
export const LIVE_OPS_EXCEPTIONS_HREF = "/v2/admin/ops?view=exceptions";
export const CALENDAR_HREF = "/v2/admin/calendar";
export const COMMAND_QUEUE_HREF = "/v2/admin#work-queue";

export function quoteHref(quoteId: string): string {
  return `/v2/admin/quotes/${encodeURIComponent(quoteId)}`;
}

export function accountHref(userId: string): string {
  return `/v2/admin/accounts/users/${encodeURIComponent(userId)}`;
}

export function shoppingRunHref(runId: string): string {
  return `/v2/admin/inventory/shopping/${encodeURIComponent(runId)}`;
}

/** A contact link for a free-text guest contact: mailto, tel, or nothing. */
export function contactHref(contact: string | null | undefined): string | null {
  const value = (contact ?? "").trim();
  if (!value) return null;
  const email = value.match(/[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/);
  if (email) return `mailto:${email[0]}`;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length >= 8) return `tel:${digits}`;
  return null;
}
