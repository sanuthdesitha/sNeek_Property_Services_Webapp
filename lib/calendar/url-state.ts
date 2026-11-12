/**
 * Calendar view state in the URL: `view`, `date`, `rows`, `clientId`,
 * `status`, `unassigned`, `laundry`, `arrivals` (and `open` for the peek
 * panel, owned by `usePeekParam`). Unrelated parameters are left alone.
 *
 * Saved preferences (rows, laundry runs, guest arrivals, "only without a
 * cleaner") are the fallback when the URL does not say, so they survive a full
 * refresh, which resets view parameters app-wide (see view memory).
 *
 * Documented exception to that reset (docs/style/operational-ui.md,
 * "Returning to a workspace"): the Calendar also restores its VIEW (saved
 * always) and its DATE (saved for this browser session only, and only on the
 * Sydney day it was saved), so a refresh keeps the week being planned while a
 * new visit, or the next day, opens on today. See `CalendarRestore`.
 */
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { CALENDAR_VIEWS, isDayKey, type CalendarView } from "./range";

export const CALENDAR_STATUS_GROUPS = {
  all: { label: "All statuses", statuses: null },
  offered: { label: "Offered", statuses: ["OFFERED"] },
  planned: { label: "Planned", statuses: ["ASSIGNED", "EN_ROUTE"] },
  onsite: { label: "On site", statuses: ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] },
  done: { label: "Done", statuses: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
  /** Cancelled jobs are shown only through this filter (Wave E). */
  cancelled: { label: "Cancelled", statuses: ["CANCELLED"] },
} as const satisfies Record<string, { label: string; statuses: readonly string[] | null }>;
export type CalendarStatusGroup = keyof typeof CALENDAR_STATUS_GROUPS;
/** A status group, or one job status (the single-status filter the old calendar offered). */
export type CalendarStatusFilter = CalendarStatusGroup | string;

export function isCalendarStatusFilter(value: string | null): value is CalendarStatusFilter {
  if (!value) return false;
  return Object.prototype.hasOwnProperty.call(CALENDAR_STATUS_GROUPS, value) || Object.prototype.hasOwnProperty.call(STATUS_LABELS, value);
}

/** The job statuses a filter selects, or null for every status. */
export function statusesForFilter(filter: CalendarStatusFilter): readonly string[] | null {
  if (Object.prototype.hasOwnProperty.call(CALENDAR_STATUS_GROUPS, filter)) return CALENDAR_STATUS_GROUPS[filter as CalendarStatusGroup].statuses;
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, filter) ? [filter] : null;
}

export function statusFilterLabel(filter: CalendarStatusFilter): string {
  if (Object.prototype.hasOwnProperty.call(CALENDAR_STATUS_GROUPS, filter)) return CALENDAR_STATUS_GROUPS[filter as CalendarStatusGroup].label;
  return STATUS_LABELS[filter] ?? filter;
}

export type CalendarRowsMode = "cleaners" | "properties";

export type CalendarPrefs = { rows: CalendarRowsMode; laundry: boolean; arrivals: boolean; unassigned: boolean };
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = { rows: "cleaners", laundry: true, arrivals: true, unassigned: false };

export type CalendarUrlState = CalendarPrefs & {
  /** Null: not in the URL; the page picks Week on wide screens, Day on phones. */
  view: CalendarView | null;
  /** Null: today (Sydney). */
  date: string | null;
  clientId: string | null;
  status: CalendarStatusFilter;
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function readFlag(value: string | null, fallback: boolean): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

/** What a refresh may restore when the URL lacks `view` / `date`. */
export type CalendarRestore = { view: CalendarView | null; date: string | null };
export const NO_CALENDAR_RESTORE: CalendarRestore = { view: null, date: null };

/** A stored view, validated (unknown values restore nothing). */
export function parseStoredView(raw: unknown): CalendarView | null {
  return typeof raw === "string" && (CALENDAR_VIEWS as readonly string[]).includes(raw) ? (raw as CalendarView) : null;
}

export type StoredCalendarDate = { date: string; savedOn: string };

/**
 * The session date to restore: only a real day key saved on the current
 * Sydney day. A date saved yesterday (a tab left open overnight) restores
 * nothing, so the calendar opens on today.
 */
export function restorableSessionDate(raw: unknown, todayKey: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StoredCalendarDate>;
  if (!isDayKey(value.date ?? null) || value.savedOn !== todayKey) return null;
  return value.date as string;
}

export function readCalendarState(
  params: URLSearchParams,
  prefs: CalendarPrefs = DEFAULT_CALENDAR_PREFS,
  restore: CalendarRestore = NO_CALENDAR_RESTORE,
): CalendarUrlState {
  const view = params.get("view") ?? restore.view;
  const date = params.get("date") ?? restore.date;
  const rows = params.get("rows");
  const clientId = params.get("clientId");
  const status = params.get("status");
  return {
    view: (CALENDAR_VIEWS as readonly string[]).includes(view ?? "") ? (view as CalendarView) : null,
    date: isDayKey(date) ? date : null,
    rows: rows === "cleaners" || rows === "properties" ? rows : prefs.rows,
    clientId: clientId && ID_PATTERN.test(clientId) ? clientId : null,
    status: isCalendarStatusFilter(status) ? status : "all",
    unassigned: readFlag(params.get("unassigned"), prefs.unassigned),
    laundry: readFlag(params.get("laundry"), prefs.laundry),
    arrivals: readFlag(params.get("arrivals"), prefs.arrivals),
  };
}

const OWNED_KEYS = ["view", "date", "rows", "clientId", "status", "unassigned", "laundry", "arrivals"];

export function writeCalendarState(previous: URLSearchParams, state: CalendarUrlState): URLSearchParams {
  const params = new URLSearchParams(previous);
  for (const key of OWNED_KEYS) params.delete(key);
  if (state.view) params.set("view", state.view);
  if (state.date) params.set("date", state.date);
  params.set("rows", state.rows);
  if (state.clientId) params.set("clientId", state.clientId);
  if (state.status !== "all") params.set("status", state.status);
  params.set("unassigned", state.unassigned ? "1" : "0");
  params.set("laundry", state.laundry ? "1" : "0");
  params.set("arrivals", state.arrivals ? "1" : "0");
  return params;
}

export function prefsFromState(state: CalendarUrlState): CalendarPrefs {
  return { rows: state.rows, laundry: state.laundry, arrivals: state.arrivals, unassigned: state.unassigned };
}

export function parsePrefs(raw: unknown): CalendarPrefs {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    rows: value.rows === "properties" ? "properties" : "cleaners",
    laundry: typeof value.laundry === "boolean" ? value.laundry : DEFAULT_CALENDAR_PREFS.laundry,
    arrivals: typeof value.arrivals === "boolean" ? value.arrivals : DEFAULT_CALENDAR_PREFS.arrivals,
    unassigned: typeof value.unassigned === "boolean" ? value.unassigned : DEFAULT_CALENDAR_PREFS.unassigned,
  };
}

/** The range endpoint's query for a view, range and filters. */
export function calendarApiQuery(range: { start: string; end: string }, state: CalendarUrlState): string {
  const params = new URLSearchParams({ start: range.start, end: range.end, rows: state.rows });
  const statuses = statusesForFilter(state.status);
  if (statuses) params.set("status", statuses.join(","));
  if (state.clientId) params.set("clientId", state.clientId);
  if (state.unassigned) params.set("unassigned", "1");
  if (state.laundry) params.set("laundry", "1");
  return params.toString();
}
