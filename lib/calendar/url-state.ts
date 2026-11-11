/**
 * Calendar view state in the URL: `view`, `date`, `rows`, `clientId`,
 * `status`, `unassigned`, `laundry`, `arrivals` (and `open` for the peek
 * panel, owned by `usePeekParam`). Unrelated parameters are left alone.
 *
 * Saved preferences (rows, laundry runs, guest arrivals, "only without a
 * cleaner") are the fallback when the URL does not say, so they survive a full
 * refresh, which resets view parameters app-wide (see view memory).
 */
import { CALENDAR_VIEWS, isDayKey, type CalendarView } from "./range";

export const CALENDAR_STATUS_GROUPS = {
  all: { label: "All statuses", statuses: null },
  offered: { label: "Offered", statuses: ["OFFERED"] },
  planned: { label: "Planned", statuses: ["ASSIGNED", "EN_ROUTE"] },
  onsite: { label: "On site", statuses: ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] },
  done: { label: "Done", statuses: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
} as const satisfies Record<string, { label: string; statuses: readonly string[] | null }>;
export type CalendarStatusGroup = keyof typeof CALENDAR_STATUS_GROUPS;

export type CalendarRowsMode = "cleaners" | "properties";

export type CalendarPrefs = { rows: CalendarRowsMode; laundry: boolean; arrivals: boolean; unassigned: boolean };
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = { rows: "cleaners", laundry: true, arrivals: true, unassigned: false };

export type CalendarUrlState = CalendarPrefs & {
  /** Null: not in the URL; the page picks Week on wide screens, Day on phones. */
  view: CalendarView | null;
  /** Null: today (Sydney). */
  date: string | null;
  clientId: string | null;
  status: CalendarStatusGroup;
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function readFlag(value: string | null, fallback: boolean): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

export function readCalendarState(params: URLSearchParams, prefs: CalendarPrefs = DEFAULT_CALENDAR_PREFS): CalendarUrlState {
  const view = params.get("view");
  const date = params.get("date");
  const rows = params.get("rows");
  const clientId = params.get("clientId");
  const status = params.get("status");
  return {
    view: (CALENDAR_VIEWS as readonly string[]).includes(view ?? "") ? (view as CalendarView) : null,
    date: isDayKey(date) ? date : null,
    rows: rows === "cleaners" || rows === "properties" ? rows : prefs.rows,
    clientId: clientId && ID_PATTERN.test(clientId) ? clientId : null,
    status: status && Object.prototype.hasOwnProperty.call(CALENDAR_STATUS_GROUPS, status) ? (status as CalendarStatusGroup) : "all",
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
  const statuses = CALENDAR_STATUS_GROUPS[state.status].statuses;
  if (statuses) params.set("status", statuses.join(","));
  if (state.clientId) params.set("clientId", state.clientId);
  if (state.unassigned) params.set("unassigned", "1");
  if (state.laundry) params.set("laundry", "1");
  return params.toString();
}
