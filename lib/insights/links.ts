/**
 * Links from an Insights figure to the records behind it, using only the URL
 * parameters those pages already read:
 *  - Jobs list (lib/jobs/workspace-state): propertyId, clientId, cleanerId,
 *    jobType, dateFrom, dateTo (yyyy-MM-dd).
 *  - Quality hub (lib/quality/filters + period): tab, propertyId, cleanerId,
 *    category, period=custom&from&to.
 *  - Client invoices (components/v2/admin/finance/invoices): tab=invoices,
 *    client, status.
 *
 * Pure.
 */
import type { JobType } from "@prisma/client";

export type DaySpan = { fromKey: string; toKey: string };

function href(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function jobsHref(
  span: DaySpan,
  scope: { propertyId?: string; clientId?: string; cleanerId?: string; jobType?: JobType } = {},
): string {
  return href("/v2/admin/jobs", {
    propertyId: scope.propertyId,
    clientId: scope.clientId,
    cleanerId: scope.cleanerId,
    jobType: scope.jobType,
    dateFrom: span.fromKey,
    dateTo: span.toKey,
  });
}

export function qualityIssuesHref(
  span: DaySpan,
  scope: { propertyId?: string; cleanerId?: string; category?: string } = {},
): string {
  return href("/v2/admin/quality", {
    tab: "issues",
    period: "custom",
    from: span.fromKey,
    to: span.toKey,
    propertyId: scope.propertyId,
    cleanerId: scope.cleanerId,
    category: scope.category,
  });
}

export function qualityCleanersHref(span: DaySpan, cleanerId?: string): string {
  return href("/v2/admin/quality", { tab: "cleaners", period: "custom", from: span.fromKey, to: span.toKey, cleanerId });
}

export function invoicesHref(scope: { clientId?: string; status?: "overdue" | "active" } = {}): string {
  return href("/v2/admin/finance", { tab: "invoices", client: scope.clientId, status: scope.status });
}
