/**
 * Words and formatting for the damage report record page. Plain module (safe
 * for the server page). Times are shown in the organisation timezone the
 * server page supplies; a missing value is said in words, never blank or $0.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { EPillTone } from "@/components/v2/ui/pill";
import type { ETone } from "@/components/v2/ui/tone-band";

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Sent back to the cleaner",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  CLOSED: "Closed",
};

export const SEVERITY_LABEL: Record<string, string> = { MINOR: "Minor", MODERATE: "Moderate", MAJOR: "Major", SEVERE: "Severe" };

export const CAUSE_LABEL: Record<string, string> = { GUEST: "guest", WEAR: "wear and tear", PRE_EXISTING: "already there", UNKNOWN: "not sure" };

export const SECTION_LABEL: Record<string, string> = { OVERVIEW: "Overview", CLOSE_UP: "Close-up", CONTEXT: "Context", EVIDENCE: "Evidence" };

export const CASE_STATE_LABEL: Record<string, string> = {
  OPEN: "Open",
  TRIAGE: "In triage",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  AWAITING_CLIENT: "Waiting for the client",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const REPAIR_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  ORDERED: "Ordered",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export function titleText(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function severityPillTone(severity: string | null): EPillTone {
  if (severity === "SEVERE" || severity === "MAJOR") return "bad";
  if (severity === "MODERATE") return "warn";
  return "neutral";
}

export function statusPillTone(status: string, clientVisible: boolean): EPillTone {
  if (status === "CLOSED") return "neutral";
  if (status === "DRAFT") return "warn";
  return clientVisible ? "ok" : "gold";
}

/** The item card's band: major damage is a problem; an unestimated item waits on the office. */
export function itemBand(severity: string, estimated: boolean): { tone: ETone; pill: string } | null {
  const label = SEVERITY_LABEL[severity] ?? titleText(severity);
  if (severity === "SEVERE" || severity === "MAJOR") return { tone: "problem", pill: estimated ? label : `${label} · no estimate` };
  if (!estimated) return { tone: "attention", pill: `${label} · no estimate` };
  return null;
}

export function money(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function valid(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Tue 10 Nov 12:48" in the organisation timezone. */
export function dayTime(iso: string | null | undefined, timeZone: string): string | null {
  const date = valid(iso);
  return date ? formatInTimeZone(date, timeZone, "EEE d MMM HH:mm") : null;
}

/** "Tue 10 Nov" (a calendar day in the organisation timezone). */
export function dayOnly(iso: string | null | undefined, timeZone: string): string | null {
  const date = valid(iso);
  return date ? formatInTimeZone(date, timeZone, "EEE d MMM") : null;
}

/** "Wed 09:12" for recent steps. */
export function weekdayTime(iso: string | null | undefined, timeZone: string): string | null {
  const date = valid(iso);
  return date ? formatInTimeZone(date, timeZone, "EEE HH:mm") : null;
}

export function firstName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "the cleaner";
}

/** A short readable time zone label, "Sydney time". */
export function zoneLabel(timeZone: string): string {
  const city = timeZone.split("/").pop()?.replace(/_/g, " ");
  return city ? `${city} time` : `${timeZone} time`;
}

export function newIdempotencyKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`.slice(0, 80);
}
