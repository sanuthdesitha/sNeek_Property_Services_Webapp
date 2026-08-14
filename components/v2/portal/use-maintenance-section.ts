"use client";

/**
 * CP-6 — portal gate for the maintenance section.
 *
 * The v2 portal layouts are client components, so visibility has to be fetched
 * rather than computed server-side. This mirrors the attention-counts poll the
 * cleaner layout already runs: one small read, refreshed on an interval and on
 * focus.
 *
 * A failed or pending fetch reports "not assigned", so the section stays hidden
 * until we positively know otherwise — a nav entry that flickers in and then
 * 403s is worse than one that appears a second late.
 */
import * as React from "react";

export interface MaintenanceSectionState {
  /** True only when the signed-in user holds at least one open assignment. */
  assigned: boolean;
  /** How many open maintenance items they are on — drives the nav badge. */
  count: number;
}

export function useMaintenanceSection(): MaintenanceSectionState {
  const [state, setState] = React.useState<MaintenanceSectionState>({ assigned: false, count: 0 });

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/maintenance/assigned/summary", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (cancelled || !body) return;
          setState({
            assigned: body.assigned === true,
            count: typeof body.count === "number" ? body.count : 0,
          });
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  return state;
}
