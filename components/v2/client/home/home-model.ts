/**
 * Derivations for the client Home and dashboard from data the server already
 * loaded (no queries). Plain module: server components and tests read it.
 * All days are Sydney days; a job's calendar date is never shifted.
 */
import { formatInTimeZone } from "date-fns-tz";
import { CLIENT_LAUNDRY_STATUS_LABELS } from "@/lib/client/laundry-status";

export const HOME_TZ = "Australia/Sydney";

export const ACTIVE_JOB_STATUSES: readonly string[] = [
  "UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED",
  "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW",
];

/** A clean the cleaner is travelling to or working on right now. */
export const LIVE_JOB_STATUSES: readonly string[] = ["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"];

export interface HomeJob {
  id: string;
  status: string;
  jobType: string;
  scheduledDate: Date;
  startTime: string | null;
  dueTime?: string | null;
  property: { id?: string; name: string; suburb?: string | null };
  assignments: Array<{ user?: { name?: string | null } | null }>;
}

export function sydneyKey(date: Date): string {
  return formatInTimeZone(date, HOME_TZ, "yyyy-MM-dd");
}

export function sydneyFormat(date: Date, pattern: string): string {
  return formatInTimeZone(date, HOME_TZ, pattern);
}

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Airbnb turnover" style. */
export function sentence(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function cleanerNames(job: HomeJob): string | null {
  const names = job.assignments.map((assignment) => assignment.user?.name).filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(" & ") : null;
}

/** Upcoming = active cleans from today on, soonest first. Past-but-open cleans stay on the jobs board. */
export function upcomingJobs<T extends HomeJob>(jobs: readonly T[], todayKey: string): T[] {
  return jobs
    .filter((job) => ACTIVE_JOB_STATUSES.includes(job.status) && sydneyKey(job.scheduledDate) >= todayKey)
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime() || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/** The clean happening today, if any (live status on today's Sydney date). */
export function happeningNow<T extends HomeJob>(jobs: readonly T[], todayKey: string): T | null {
  return jobs.find((job) => LIVE_JOB_STATUSES.includes(job.status) && sydneyKey(job.scheduledDate) === todayKey) ?? null;
}

export function liveLabel(status: string): string {
  if (status === "EN_ROUTE") return "On the way";
  if (status === "IN_PROGRESS") return "On site";
  return "Paused";
}

/** Board badges: an assigned clean is "Confirmed"; nobody yet is "Awaiting cleaner". */
export function upcomingBadge(status: string): { label: string; tone: "success" | "warning" | "info" | "neutral" } {
  if (status === "UNASSIGNED" || status === "OFFERED") return { label: "Awaiting cleaner", tone: "warning" };
  if (status === "ASSIGNED") return { label: "Confirmed", tone: "success" };
  if (LIVE_JOB_STATUSES.includes(status)) return { label: liveLabel(status), tone: "info" };
  return { label: titleCase(status), tone: "neutral" };
}

export function greetingFor(now: Date): string {
  const hour = Number(formatInTimeZone(now, HOME_TZ, "H"));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export interface StockRow {
  propertyId: string;
  onHand: number;
  reorderThreshold: number;
  parLevel: number;
  property: { id: string; name: string };
  item: { name: string };
}

export interface LowStockSummary {
  total: number;
  properties: number;
  byProperty: Map<string, { low: number; tracked: number; preview: string[] }>;
}

export function lowStock(rows: readonly StockRow[]): LowStockSummary {
  const byProperty = new Map<string, { low: number; tracked: number; preview: string[] }>();
  for (const row of rows) {
    const entry = byProperty.get(row.propertyId) ?? { low: 0, tracked: 0, preview: [] };
    entry.tracked += 1;
    if (row.onHand <= row.reorderThreshold) {
      entry.low += 1;
      if (entry.preview.length < 3) entry.preview.push(`${row.item.name} ${row.onHand} of ${row.parLevel}`);
    }
    byProperty.set(row.propertyId, entry);
  }
  const lowEntries = Array.from(byProperty.values()).filter((entry) => entry.low > 0);
  return { total: lowEntries.reduce((sum, entry) => sum + entry.low, 0), properties: lowEntries.length, byProperty };
}

export interface LaundryRow {
  id: string;
  status: string;
  pickupDate: Date;
  dropoffDate: Date;
  droppedAt: Date | null;
  property: { id: string; name: string; suburb?: string | null };
}

export const LAUNDRY_LABEL: Record<string, string> = CLIENT_LAUNDRY_STATUS_LABELS;

/** One line per property: the open laundry run if there is one, else the latest delivered. */
export function laundryByProperty(rows: readonly LaundryRow[]): Map<string, string> {
  const chosen = new Map<string, { text: string; open: boolean }>();
  const ordered = [...rows].sort((a, b) => a.pickupDate.getTime() - b.pickupDate.getTime());
  for (const row of ordered) {
    const open = row.status !== "DROPPED" && row.status !== "SKIPPED_PICKUP";
    const label = LAUNDRY_LABEL[row.status] ?? titleCase(row.status);
    const text = open
      ? `${label} · pickup ${sydneyFormat(row.pickupDate, "EEE d MMM")} · back ${sydneyFormat(row.dropoffDate, "EEE d MMM")}`
      : `${label} ${sydneyFormat(row.droppedAt ?? row.dropoffDate, "EEE d MMM")}`;
    const existing = chosen.get(row.property.id);
    // The earliest open run wins; otherwise the most recent finished one.
    if (!existing?.open) chosen.set(row.property.id, { text, open });
  }
  return new Map(Array.from(chosen, ([id, entry]) => [id, entry.text]));
}
