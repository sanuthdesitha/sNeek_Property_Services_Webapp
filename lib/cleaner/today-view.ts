/**
 * Display helpers for the cleaner Today screen (approved board, 2026-11).
 * Pure and plain (no "use client"): the server page and its tests use them.
 * Nothing here computes money or decides who sees what.
 */

export type TodayStatusTone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

export interface TodayAddressParts {
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}

/** Full, never-truncated address line: "address, suburb STATE postcode". */
export function fullAddress(property: TodayAddressParts): string {
  const locality = [property.suburb, property.state, property.postcode].filter(Boolean).join(" ");
  return [property.address, locality].filter(Boolean).join(", ");
}

/** Expected on-site duration — minutes preferred, hours as a fallback. Null when unknown. */
export function durationLabel(minutes: number | null | undefined, hours: number | null | undefined): string | null {
  if (minutes && minutes > 0) {
    if (minutes < 60) return `${minutes} min`;
    const whole = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${whole} h ${rest}` : `${whole} h`;
  }
  if (hours && hours > 0) {
    const whole = Math.floor(hours);
    const rest = Math.round((hours - whole) * 60);
    return rest ? `${whole} h ${rest}` : `${whole} h`;
  }
  return null;
}

/** "10:00 – 14:00", "10:00", or "Time not set". */
export function timeWindow(startTime: string | null, dueTime: string | null): string {
  if (startTime && dueTime) return `${startTime} – ${dueTime}`;
  return startTime ?? (dueTime ? `Finish by ${dueTime}` : "Time not set");
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function statusTone(status: string): TodayStatusTone {
  switch (status) {
    case "UNASSIGNED":
    case "OFFERED":
    case "SUBMITTED":
      return "warning";
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary";
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
    case "INVOICED":
      return "success";
    default:
      return "neutral";
  }
}

export function formatAud(amount: number): string {
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The clock as the server records it: an open time log, none, or a read that
 * failed. "Unknown" is shown as unknown, never as "not clocked in".
 */
export type TodayClockState =
  | { kind: "not-clocked-in" }
  | { kind: "clocked-in"; jobId: string; propertyName: string; since: string }
  | { kind: "unknown" };

/** Summary line under the greeting: "3 accepted jobs today · 1 offer waiting". */
export function todaySummaryLine(acceptedToday: number | null, offersWaiting: number | null): string {
  if (acceptedToday === null) return "Your shift could not be loaded.";
  const jobs = acceptedToday === 0
    ? "No accepted jobs scheduled today"
    : `${acceptedToday} accepted job${acceptedToday === 1 ? "" : "s"} today`;
  if (!offersWaiting) return `${jobs}.`;
  return `${jobs} · ${offersWaiting} offer${offersWaiting === 1 ? "" : "s"} waiting`;
}

export function greetingFor(hour: number): "Morning" | "Afternoon" | "Evening" {
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}
