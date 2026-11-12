"use client";

/** Keeps the Lost and found view in the URL (replaceState) and follows Back/Forward. */
import { useCallback, useEffect, useState } from "react";
import { PAGE_RESETTING_KEYS, readLostFoundView, viewSearch, type LostFoundView } from "./lost-found-view";

export function useLostFoundView(initial: LostFoundView): [LostFoundView, (patch: Partial<LostFoundView>) => void] {
  const [view, setView] = useState<LostFoundView>(initial);

  useEffect(() => {
    const sync = () => setView(readLostFoundView(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: Partial<LostFoundView>) => {
    setView((current) => {
      const resetsPage = PAGE_RESETTING_KEYS.some((key) => key in patch);
      const next: LostFoundView = { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
      if (patch.tab && patch.tab !== "closed") next.closedAs = "";
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${viewSearch(next)}${window.location.hash}`);
      return next;
    });
  }, []);

  return [view, update];
}
