/**
 * Maintenance Tickets › "By day" (board "Maintenance portal", screen 4).
 *
 * Groups the tickets already on the page by their planned Sydney day: Today,
 * then each later day in order, then earlier days (overdue), then "Not
 * scheduled". An unreadable date goes to "Schedule unavailable" rather than
 * being guessed. Presentation only; the page's filters and paging are unchanged.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";

const TZ = "Australia/Sydney";

export interface TicketDayGroup {
  key: string;
  label: string;
  tickets: MaintenanceTicketSummary[];
}

function dayKey(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, TZ, "yyyy-MM-dd") : null;
}

/** Resolved and dismissed work orders are finished; a past day holding only those is not overdue. */
const CLOSED_STATUSES = new Set(["RESOLVED", "DISMISSED"]);

function dayLabel(key: string, todayKey: string, tickets: readonly MaintenanceTicketSummary[]): string {
  if (key === todayKey) return "Today";
  const noonUtc = new Date(`${key}T02:00:00Z`);
  const label = formatInTimeZone(noonUtc, TZ, "EEEE d MMM");
  const stillOpen = tickets.some((ticket) => !CLOSED_STATUSES.has(ticket.status));
  return key < todayKey && stillOpen ? `${label} · overdue` : label;
}

export function groupTicketsByDay(tickets: readonly MaintenanceTicketSummary[], now: Date = new Date()): TicketDayGroup[] {
  const todayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const byKey = new Map<string, MaintenanceTicketSummary[]>();
  const unscheduled: MaintenanceTicketSummary[] = [];
  const unreadable: MaintenanceTicketSummary[] = [];
  for (const ticket of tickets) {
    if (!ticket.scheduledFor) {
      unscheduled.push(ticket);
      continue;
    }
    const key = dayKey(ticket.scheduledFor);
    if (!key) {
      unreadable.push(ticket);
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), ticket]);
  }
  const keys = Array.from(byKey.keys());
  const upcoming = keys.filter((key) => key >= todayKey).sort();
  const overdue = keys.filter((key) => key < todayKey).sort();
  const byTime = (a: MaintenanceTicketSummary, b: MaintenanceTicketSummary) =>
    String(a.scheduledFor).localeCompare(String(b.scheduledFor));
  const groups: TicketDayGroup[] = [...upcoming, ...overdue].map((key) => {
    const dayTickets = [...(byKey.get(key) ?? [])].sort(byTime);
    return { key, label: dayLabel(key, todayKey, dayTickets), tickets: dayTickets };
  });
  if (unscheduled.length) groups.push({ key: "unscheduled", label: "Not scheduled", tickets: unscheduled });
  if (unreadable.length) groups.push({ key: "unreadable", label: "Schedule unavailable", tickets: unreadable });
  return groups;
}
