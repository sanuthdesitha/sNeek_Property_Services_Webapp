/**
 * Wording and formatting for the admin Maintenance screens. Pure (no
 * "use client"): times are formatted in the organisation's timezone the server
 * page supplies; a missing value is said in words ("Not booked", "Not
 * estimated"), never shown as blank, $0 or today.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { MaintenancePriority, MaintenanceStatus } from "@prisma/client";
import type { EPillTone } from "@/components/v2/ui/pill";

export function money(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Thu 13 Nov" and "08:00", or "Today" for the organisation's today. */
export function visitParts(iso: string | null | undefined, timeZone: string, now: Date = new Date()): { day: string; time: string } | null {
  const date = validDate(iso);
  if (!date) return null;
  const sameDay = formatInTimeZone(date, timeZone, "yyyy-MM-dd") === formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return {
    day: sameDay ? "Today" : formatInTimeZone(date, timeZone, "EEE d MMM"),
    time: formatInTimeZone(date, timeZone, "HH:mm"),
  };
}

/** "Mon 10 Nov 11:42" in the organisation's timezone; null when missing. */
export function dayTime(iso: string | null | undefined, timeZone: string): string | null {
  const date = validDate(iso);
  return date ? formatInTimeZone(date, timeZone, "EEE d MMM HH:mm") : null;
}

/** "3 d ago", "today". */
export function ageLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const date = validDate(iso);
  if (!date) return null;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return `${days} d ago`;
}

export function priorityTone(priority: MaintenancePriority | string): EPillTone {
  if (priority === "URGENT") return "bad";
  if (priority === "HIGH") return "warn";
  if (priority === "MEDIUM") return "info";
  return "neutral";
}

export function statusTone(status: MaintenanceStatus | string): EPillTone {
  switch (status) {
    case "OPEN":
      return "warn";
    case "IN_PROGRESS":
      return "info";
    case "ORDERED":
      return "warn";
    case "RESOLVED":
      return "ok";
    default:
      return "neutral";
  }
}

export type PriceState = "NOT_SENT" | "PENDING" | "APPROVED" | "DECLINED";

export function priceState(value: string | null | undefined): PriceState {
  if (value === "PENDING" || value === "APPROVED" || value === "DECLINED") return value;
  return "NOT_SENT";
}

export const PRICE_STATE_LABELS: Record<PriceState, string> = {
  NOT_SENT: "Not sent",
  PENDING: "Awaiting client",
  APPROVED: "Approved",
  DECLINED: "Declined",
};

/**
 * The cost cell: the client price when one was sent (with its state), else our
 * estimate, else "Not estimated".
 */
export function costSummary(item: { quotedCost: number | null; estimatedCost: number | null; costApprovalStatus: string | null }): {
  amount: string | null;
  note: string;
  tone: "warning" | "danger" | "success" | "muted";
} {
  const state = priceState(item.costApprovalStatus);
  if (state !== "NOT_SENT") {
    const tone = state === "PENDING" ? "warning" : state === "DECLINED" ? "danger" : "success";
    return { amount: money(item.quotedCost), note: state === "PENDING" ? "Awaiting client" : PRICE_STATE_LABELS[state], tone };
  }
  const estimate = money(item.estimatedCost);
  return estimate ? { amount: estimate, note: "estimate", tone: "muted" } : { amount: null, note: "Not estimated", tone: "muted" };
}

export const ASSIGNEE_ROLE_SHORT: Record<"MAINTENANCE" | "CLEANER" | "QA", string> = {
  MAINTENANCE: "Worker",
  CLEANER: "Cleaner",
  QA: "QA",
};

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
