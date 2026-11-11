"use client";

/** Keeps the Accounts view in the URL (replaceState) and follows Back/Forward. */
import { useCallback, useEffect, useState } from "react";
import { rememberCurrentView } from "@/lib/navigation/view-memory";
import { readAccountsView, viewSearch, type AccountsView } from "./accounts-view";

export { DEFAULT_VIEW, listQueryString, readAccountsView, viewSearch, type AccountsView } from "./accounts-view";

export function useAccountsView(initial: AccountsView): [AccountsView, (patch: Partial<AccountsView>) => void] {
  const [view, setView] = useState<AccountsView>(initial);

  useEffect(() => {
    const sync = () => setView(readAccountsView(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: Partial<AccountsView>) => {
    setView((current) => {
      // Any change to what is listed starts again at page 1.
      const resetsPage = ["tab", "q", "status", "documents", "role", "sort", "dir"].some((key) => key in patch);
      const next: AccountsView = { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
      if (patch.tab && patch.tab !== current.tab) next.role = "";
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${viewSearch(next)}${window.location.hash}`);
      rememberCurrentView();
      return next;
    });
  }, []);

  return [view, update];
}
