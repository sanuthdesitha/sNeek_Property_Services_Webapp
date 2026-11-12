/**
 * Display helpers for the Lost and found page. Pure (no React), so the table,
 * the panel and their tests word things the same way.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { EPillTone } from "@/components/v2/ui/pill";
import type { EStage } from "@/components/v2/ui/stage-bar";
import type { HoldingState, UnprocessedFlag } from "@/lib/lost-found/holding";
import {
  LOST_FOUND_STAGES,
  LOST_FOUND_STAGE_LABELS,
  lostFoundStageOf,
  lostFoundStatusLabel,
  type LostFoundStage,
} from "@/lib/lost-found/status";

export function formatFoundDay(iso: string, timeZone: string, now = new Date()): string {
  const day = formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd");
  if (day === formatInTimeZone(now, timeZone, "yyyy-MM-dd")) return "Today";
  const sameYear = day.slice(0, 4) === formatInTimeZone(now, timeZone, "yyyy");
  return formatInTimeZone(new Date(iso), timeZone, sameYear ? "d MMM" : "d MMM yyyy");
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "Not recorded";
  return formatInTimeZone(new Date(iso), timeZone, "d MMM yyyy, h:mm a");
}

/** Booking dates are calendar dates; shown in the organisation's calendar. */
export function formatStay(startIso: string, endIso: string, timeZone: string): string {
  const start = formatInTimeZone(new Date(startIso), timeZone, "d MMM");
  const end = formatInTimeZone(new Date(endIso), timeZone, "d MMM yyyy");
  return `${start} – ${end}`;
}

export type GuestSourceInfo = { label: string; tone: "booking" | "office" | "none" | "unknown" };

/** "from booking" / "entered by office" / "No booking on job" — never a guess. */
export function guestSourceInfo(row: { guestSource: string | null; jobHasBooking: boolean | null; jobId: string | null }): GuestSourceInfo {
  if (row.guestSource === "BOOKING") return { label: "from booking", tone: "booking" };
  if (row.guestSource === "MANUAL") return { label: "entered by office", tone: "office" };
  if (row.jobId && row.jobHasBooking === false) return { label: "No booking on job", tone: "none" };
  if (!row.jobId) return { label: "No job linked", tone: "none" };
  return { label: "Not recorded", tone: "unknown" };
}

export type StatusPill = { label: string; tone: EPillTone };

const STAGE_TONE: Record<LostFoundStage, EPillTone> = {
  new: "bad",
  storage: "neutral",
  contacted: "info",
  return: "gold",
  closed: "neutral",
};

/** The table's status pill: stage label, days held, warning past the holding period. */
export function statusPill(status: string, holding: HoldingState, unprocessed: UnprocessedFlag = null): StatusPill {
  const stage = lostFoundStageOf(status);
  const label = stage === "closed" ? lostFoundStatusLabel(status) : LOST_FOUND_STAGE_LABELS[stage];
  // Wave F: still New after the named threshold: flagged with its age.
  if (unprocessed) return { label: `${label} · ${unprocessed.days} d`, tone: "warn" };
  const tone: EPillTone = status === "RETURNED" ? "ok" : holding.past ? "warn" : STAGE_TONE[stage];
  if (holding.counts && holding.days !== null) return { label: `${label} · ${holding.days} d`, tone };
  return { label, tone };
}

/** Statuses an item has been at, read from its timeline. */
export function visitedStatuses(events: Array<{ action: string; meta: unknown }>): Set<string> {
  const visited = new Set<string>(["REPORTED"]);
  for (const event of events) {
    if (event.action === "GUEST_CONTACTED") visited.add("GUEST_CONTACTED");
    if (event.action === "OFFER_RETURN") visited.add("RETURN_OFFERED");
    const meta = event.meta as { toStatus?: unknown } | null;
    if (meta && typeof meta.toStatus === "string") visited.add(meta.toStatus);
  }
  return visited;
}

/**
 * New → In storage → Guest contacted → Return arranged → Closed. Stages before
 * the current one are "done" only if the timeline shows the item was there;
 * otherwise "passed" (skipped, not recorded).
 */
export function lostFoundStages(status: string, visited: Set<string>): EStage[] {
  const current = lostFoundStageOf(status);
  const currentIndex = LOST_FOUND_STAGES.indexOf(current);
  const stageStatus: Record<LostFoundStage, string> = { new: "REPORTED", storage: "IN_STORAGE", contacted: "GUEST_CONTACTED", return: "RETURN_OFFERED", closed: status };
  return LOST_FOUND_STAGES.map((stage, index) => {
    const base = { key: stage, label: LOST_FOUND_STAGE_LABELS[stage] };
    if (index === currentIndex) return { ...base, state: "current" as const, note: stage === "closed" ? lostFoundStatusLabel(status) : null };
    if (index > currentIndex) return { ...base, state: "todo" as const };
    return { ...base, state: visited.has(stageStatus[stage]) ? ("done" as const) : ("passed" as const) };
  });
}
