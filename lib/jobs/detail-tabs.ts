/**
 * Admin job-detail tabs.
 *
 * Extracted from the page so the tab set and the `?tab=` resolution are
 * testable without rendering a server component — the tab key is what every
 * deep link into a job carries (approvals queues, notification CTAs, the jobs
 * board's Manage button), so an unrecognised or missing value must degrade to
 * the overview rather than render an empty page.
 */

export const JOB_DETAIL_TABS = [
  "overview",
  "schedule",
  "people",
  "quality",
  "laundry",
  "money",
  "forms",
  "scope",
  "messages",
  "activity",
  "danger",
] as const;

export type JobDetailTab = (typeof JOB_DETAIL_TABS)[number];

export const DEFAULT_JOB_DETAIL_TAB: JobDetailTab = "overview";

/**
 * Resolve a `?tab=` search param.
 *
 * Accepts the raw Next.js shape (`string | string[] | undefined`) — a repeated
 * query param arrives as an array, and taking the first entry matches what the
 * links this page emits would produce.
 */
export function resolveJobDetailTab(raw: unknown): JobDetailTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return DEFAULT_JOB_DETAIL_TAB;
  return (JOB_DETAIL_TABS as readonly string[]).includes(value)
    ? (value as JobDetailTab)
    : DEFAULT_JOB_DETAIL_TAB;
}

/** Canonical href for a tab on a given job. */
export function jobDetailTabHref(jobId: string, tab: string): string {
  return `/v2/admin/jobs/${jobId}?tab=${tab}`;
}
