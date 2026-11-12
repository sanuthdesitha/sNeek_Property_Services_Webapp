/** Formatting helpers for the client property page. Plain module. */
import { formatInTimeZone } from "date-fns-tz";

export const PROPERTY_TZ = "Australia/Sydney";

export type PropertyTone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info";

export function propertyStatusTone(status: string): PropertyTone {
  const s = status.toUpperCase();
  if (["COMPLETED", "INVOICED", "RESOLVED", "DROPPED_OFF", "RETURNED", "DROPPED"].includes(s)) return "success";
  if (["IN_PROGRESS", "EN_ROUTE", "ASSIGNED", "PICKED_UP", "QA_REVIEW", "SUBMITTED"].includes(s)) return "info";
  if (["UNASSIGNED", "OFFERED", "PAUSED", "SCHEDULED", "WAITING_CONTINUATION_APPROVAL"].includes(s)) return "warning";
  if (["CANCELLED", "SKIPPED_PICKUP", "DISMISSED"].includes(s)) return "danger";
  return "neutral";
}

export function propertyTitleCase(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** History instants in the organisation timezone. */
export function sydneyText(value: Date | string, pattern: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, PROPERTY_TZ, pattern) : "Date unavailable";
}

export type TimelineMedia = {
  id: string;
  url: string;
  label?: string | null;
  mediaType: string;
  submission: { job: { id: string; jobNumber?: string | null; jobType: string; scheduledDate: Date | string } };
};

export interface TimelineGroup {
  jobId: string;
  jobNumber?: string | null;
  jobType: string;
  scheduledDate: Date | string;
  items: TimelineMedia[];
}

/** One entry per visit, newest first; input order kept inside each visit. */
export function groupTimelineByJob(items: readonly TimelineMedia[]): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();
  for (const item of items) {
    const job = item.submission?.job;
    if (!job?.id) continue;
    const existing = groups.get(job.id);
    if (existing) existing.items.push(item);
    else groups.set(job.id, { jobId: job.id, jobNumber: job.jobNumber, jobType: job.jobType, scheduledDate: job.scheduledDate, items: [item] });
  }
  return Array.from(groups.values()).sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
}

export type PropertyTab = "overview" | "reports" | "photos" | "stock" | "laundry" | "care";
