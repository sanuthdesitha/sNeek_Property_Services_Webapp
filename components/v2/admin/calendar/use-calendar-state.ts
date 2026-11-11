"use client";

/**
 * Calendar view state, kept in the URL (`lib/calendar/url-state.ts`) so Back
 * and shared links return the same view. Rows, laundry runs, guest arrivals
 * and "only without a cleaner" are also saved as this person's preference in
 * local storage (scoped to the signed-in view scope), because a full refresh
 * resets view parameters app-wide.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { navigationScope, rememberCurrentView } from "@/lib/navigation/view-memory";
import {
  DEFAULT_CALENDAR_PREFS,
  parsePrefs,
  prefsFromState,
  readCalendarState,
  writeCalendarState,
  type CalendarPrefs,
  type CalendarUrlState,
} from "@/lib/calendar/url-state";

const PREFS_PREFIX = "sneek:calendar-prefs:v1:";
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
      current.current = readCalendarState(new URLSearchParams(window.location.search), readStoredPrefs());
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
    current.current = next;
    setState(next);
  }, []);

  return { state, ready, update };
}
