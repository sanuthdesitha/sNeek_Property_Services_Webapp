/**
 * QA issues raised from a case carry "case:<caseId>" in the existing
 * `itemKey` column (see lib/quality/raise-from-case.ts). Pure helpers, safe
 * for client components.
 */
export const CASE_ITEM_KEY_PREFIX = "case:";

export function caseItemKey(caseId: string): string {
  return `${CASE_ITEM_KEY_PREFIX}${caseId}`;
}

/** The case an issue was raised from; null for review-raised issues. */
export function caseIdFromItemKey(itemKey: string | null | undefined): string | null {
  return itemKey && itemKey.startsWith(CASE_ITEM_KEY_PREFIX) ? itemKey.slice(CASE_ITEM_KEY_PREFIX.length) || null : null;
}

export function caseHref(caseId: string): string {
  return `/v2/admin/cases?open=${encodeURIComponent(caseId)}`;
}

export function issueHubHref(issueId: string): string {
  return `/v2/admin/quality?tab=issues&q=${encodeURIComponent(issueId)}`;
}
