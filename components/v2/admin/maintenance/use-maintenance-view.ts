"use client";

/** Keeps the Maintenance view in the URL (replaceState) and follows Back/Forward. */
import { useCallback, useEffect, useState } from "react";
import { PAGE_RESETTING_KEYS, readMaintenanceView, viewSearch, type MaintenanceView } from "./maintenance-view";

export function useMaintenanceView(initial: MaintenanceView): [MaintenanceView, (patch: Partial<MaintenanceView>) => void] {
  const [view, setView] = useState<MaintenanceView>(initial);

  useEffect(() => {
    const sync = () => setView(readMaintenanceView(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: Partial<MaintenanceView>) => {
    setView((current) => {
      const resetsPage = PAGE_RESETTING_KEYS.some((key) => key in patch);
      const next: MaintenanceView = { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${viewSearch(next)}${window.location.hash}`);
      return next;
    });
  }, []);

  return [view, update];
}
