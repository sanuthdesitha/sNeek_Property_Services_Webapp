"use client";

/**
 * Calendar view state, kept in the URL (`lib/calendar/url-state.ts`) so Back
 * and shared links return the same view. Rows, laundry runs, guest arrivals
 * and "only without a cleaner" are also saved as this person's preference in
 * local storage (scoped to the signed-in view scope), because a full refresh
 * resets view parameters app-wide.
 *
 * Calendar exception to that reset (documented in operational-ui.md): the
 * view is saved in local storage and restored always; the date is saved in
 * session storage with the Sydney day it was saved on, and restored only in
 * the same browser session on the same day. A refresh keeps the week being
 * planned; a new visit opens on today. "Today" clears the saved date.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { navigationScope, rememberCurrentView } from "@/lib/navigation/view-memory";
import {
  DEFAULT_CALENDAR_PREFS,
  parsePrefs,
  parseStoredView,
  prefsFromState,
  readCalendarState,
  restorableSessionDate,
  writeCalendarState,
  type CalendarPrefs,
  type CalendarRestore,
  type CalendarUrlState,
} from "@/lib/calendar/url-state";
import { sydneyTodayKey } from "@/lib/time/sydney-range";

const PREFS_PREFIX = "sneek:calendar-prefs:v1:";
/** Not under the view-memory prefix, so a refresh does not clear it. */
const VIEW_PREFIX = "sneek:calendar-view:v1:";
const DATE_PREFIX = "sneek:calendar-date:v1:";
const WIDE_QUERY = "(min-width: 1024px)";

function prefsKey(): string {
  return `${PREFS_PREFIX}${navigationScope()}`;
}

export function readStoredPrefs(): CalendarPrefs {
  try {
    const raw = window.localStorage.getItem(prefsKey());
    return raw ? parsePrefs(JSON.parse(raw)) : DEFAULT_CALENDAR_PREFS;
  } catch {
    return DEFAULT_CALENDAR_PREFS;
  }
}

function storePrefs(prefs: CalendarPrefs): void {
  try {
    window.localStorage.setItem(prefsKey(), JSON.stringify(prefs));
  } catch {
    /* A blocked store only loses the preference, never the page. */
  }
}

export function readCalendarRestore(now: Date = new Date()): CalendarRestore {
  const scope = navigationScope();
  let view: CalendarRestore["view"] = null;
  let date: string | null = null;
  try {
    view = parseStoredView(window.localStorage.getItem(`${VIEW_PREFIX}${scope}`));
  } catch {
    view = null;
  }
  try {
    const raw = window.sessionStorage.getItem(`${DATE_PREFIX}${scope}`);
    date = raw ? restorableSessionDate(JSON.parse(raw), sydneyTodayKey(now)) : null;
  } catch {
    date = null;
  }
  return { view, date };
}

function storeRestore(state: CalendarUrlState): void {
  const scope = navigationScope();
  try {
    if (state.view) window.localStorage.setItem(`${VIEW_PREFIX}${scope}`, state.view);
  } catch {
    /* A blocked store only loses the restore, never the page. */
  }
  try {
    const key = `${DATE_PREFIX}${scope}`;
    if (state.date) window.sessionStorage.setItem(key, JSON.stringify({ date: state.date, savedOn: sydneyTodayKey() }));
    else window.sessionStorage.removeItem(key);
  } catch {
    /* As above. */
  }
}

/** True at ≥1024px, where the 7-column resource grid is usable. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return wide;
}

export type CalendarStateApi = {
  state: CalendarUrlState;
  ready: boolean;
  update: (patch: Partial<CalendarUrlState>) => void;
};

export function useCalendarState(): CalendarStateApi {
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const [state, setState] = useState<CalendarUrlState>(() => readCalendarState(new URLSearchParams(), DEFAULT_CALENDAR_PREFS));
  const [ready, setReady] = useState(false);
  const current = useRef(state);

  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      current.current = readCalendarState(params, readStoredPrefs(), readCalendarRestore());
      // A restored view/date goes back into the URL, so links and Back match the screen.
      if ((!params.get("view") && current.current.view) || (!params.get("date") && current.current.date)) {
        const clean = writeCalendarState(params, current.current).toString();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${clean ? `?${clean}` : ""}${window.location.hash}`);
      }
      storeRestore(current.current);
      setState(current.current);
      setReady(true);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [query]);

  const update = useCallback((patch: Partial<CalendarUrlState>) => {
    const next = { ...current.current, ...patch };
    const params = writeCalendarState(new URLSearchParams(window.location.search), next);
    const clean = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${clean ? `?${clean}` : ""}${window.location.hash}`);
    rememberCurrentView();
    storePrefs(prefsFromState(next));
    storeRestore(next);
    current.current = next;
    setState(next);
  }, []);

  return { state, ready, update };
}
