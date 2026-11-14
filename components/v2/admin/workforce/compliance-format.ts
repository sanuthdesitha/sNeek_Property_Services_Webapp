/**
 * Wording for Workforce › Compliance rows. Calendar dates (expiry, due) are
 * days and are shown unshifted (formatted in UTC, where they are stored);
 * instants (uploads, reminders) use the organisation timezone. Plain module.
 */
import { STATE_LABEL, type ComplianceActionRow, type LastChased } from "@/lib/workforce/compliance-rows";
import { prettify } from "./utils";

const TRANSPORT_WORD: Record<string, string> = { INBOX: "Inbox", PUSH: "Phone alert", EMAIL: "Email", SMS: "SMS" };

export function calendarDay(iso: string | null, withWeekday = false): string {
  if (!iso) return "–";
  try {
    return new Intl.DateTimeFormat("en-AU", { ...(withWeekday ? { weekday: "short" as const } : {}), day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function instant(iso: string | null, timeZone: string): string {
  if (!iso) return "–";
  try {
    return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function daysWords(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  const count = Math.abs(days);
  return days < 0 ? `${count} day${count === 1 ? "" : "s"} ago` : `in ${count} day${count === 1 ? "" : "s"}`;
}

/** The pill text: the state in words, with timing where it helps. */
export function statePill(row: ComplianceActionRow): string {
  if (row.state === "EXPIRED" && row.days !== null && row.days < 0) return `Expired ${Math.abs(row.days)} d`;
  if (row.state === "EXPIRING" && row.days !== null) return row.days === 0 ? "Expires today" : `Expires in ${row.days} d`;
  if (row.state === "OVERDUE_REQUEST") return "Past due, not uploaded";
  if (row.state === "REQUESTED" && row.dateIso) return `Due ${calendarDay(row.dateIso)}`;
  if (row.state === "WAITING_REVIEW") return "Review";
  return STATE_LABEL[row.state];
}

/** Second line under the person: what it is and where it came from. */
export function rowDetail(row: ComplianceActionRow, timeZone: string): string {
  if (row.kind === "profile_date") return `${row.title} · date on the profile, not a file`;
  if (row.kind === "request") return `${row.title} · requested${row.requestedByName ? ` by ${row.requestedByName}` : ""} ${instant(row.uploadedAt, timeZone)}`;
  if (row.state === "WAITING_REVIEW") {
    return `${row.title} · uploaded ${instant(row.uploadedAt, timeZone)}${row.requiresSignature ? " · needs signature" : ""}`;
  }
  return `${row.title}${row.verifiedByName ? ` · verified by ${row.verifiedByName}` : ""}`;
}

export function dateCell(row: ComplianceActionRow): string {
  if (row.kind === "request") return row.dateIso ? `due ${calendarDay(row.dateIso)}` : "No due date";
  if (row.state === "WAITING_REVIEW") return row.dateIso ? `expires ${calendarDay(row.dateIso)}` : "No expiry given";
  return calendarDay(row.dateIso);
}

export function chasedWords(lastChased: LastChased | null, timeZone: string): { line: string; failed: string | null } {
  if (!lastChased) return { line: "Not chased", failed: null };
  const routes = lastChased.transports.map((transport) => TRANSPORT_WORD[transport] ?? prettify(transport)).join(", ");
  const failed = lastChased.failedTransports.length
    ? `${lastChased.failedTransports.map((transport) => TRANSPORT_WORD[transport] ?? prettify(transport)).join(", ")} failed`
    : null;
  return { line: `Reminder ${instant(lastChased.at, timeZone)}${routes ? ` · ${routes}` : ""}`, failed };
}

export function remindedToday(lastChased: LastChased | null, todayKey: string, timeZone: string): boolean {
  if (!lastChased) return false;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(lastChased.at)) === todayKey;
  } catch {
    return false;
  }
}
