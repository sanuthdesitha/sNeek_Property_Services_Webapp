/**
 * Where the old Quality pages land on the hub. Every query parameter is kept
 * (the hub reads the same `cleanerId`, `propertyId`, `category`, `severity`,
 * `rectificationStatus` and `falseConfirmation` names the QA issue register
 * used); the old page's own `tab` is replaced. The register's `from`/`to`
 * created-date range becomes a custom period over the same days, so a link
 * that showed "issues raised 1–7 Nov" still shows exactly that.
 */
import type { QualityTab } from "./types";

type SearchParams = Record<string, string | string[] | undefined>;

export function qualityTabRedirect(tab: QualityTab, searchParams?: SearchParams): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  const entries = Object.entries(searchParams ?? {});
  const hasRange = entries.some(([key, value]) => (key === "from" || key === "to") && value !== undefined && value !== "");
  const hasPeriod = entries.some(([key, value]) => key === "period" && value !== undefined && value !== "");
  for (const [key, value] of entries) {
    if (key === "tab" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  if (hasRange && !hasPeriod) params.set("period", "custom");
  return `/v2/admin/quality?${params.toString()}`;
}
