"use client";

/**
 * Live "needs attention" counts for a portal's nav, keyed by nav href.
 *
 * The cleaner portal grew this behaviour first and the admin rail has its own
 * typed variant; laundry, maintenance and QA had no badges at all, so a person
 * had to open each screen to discover work waiting for them. Rather than paste
 * the same polling into four more layouts, it lives here once.
 *
 * Three deliberate choices, all about not making the navigation fragile:
 *
 *   - A FAILED POLL KEEPS THE PREVIOUS COUNTS rather than clearing them. A
 *     momentary blip must not flash real badges away and imply the work is
 *     done.
 *   - Counts refresh on an interval AND when the tab regains focus, because the
 *     common case is leaving the tab open, doing the work elsewhere, and coming
 *     back expecting the number to be right.
 *   - Errors are swallowed. A missing badge is a far smaller problem than an
 *     error boundary where the nav should be.
 */

import * as React from "react";

const REFRESH_MS = 60_000;

export function useAttentionCounts(endpoint: string): Record<string, number> {
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetch(endpoint, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          // Only replace on a good payload — see "failed poll keeps counts".
          if (!cancelled && body?.counts) setCounts(body.counts as Record<string, number>);
        })
        .catch(() => undefined);
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [endpoint]);

  return counts;
}

/** Attach counts to nav items, omitting the badge entirely when it is zero. */
export function withAttentionBadges<T extends { href: string; badge?: React.ReactNode }>(
  nav: T[],
  counts: Record<string, number>
): T[] {
  return nav.map((item) => {
    const count = counts[item.href] ?? 0;
    // A zero badge is noise — an empty queue should look empty, not like a
    // score of nil.
    return count > 0 ? { ...item, badge: count } : item;
  });
}

/** The client portal's gate payload — who is acting and what they may do. */
export interface ClientPortalGate {
  actor: "CLIENT" | "VA";
  permissions: Record<string, boolean>;
}

/**
 * Client-portal variant: counts PLUS the actor/permissions the API resolved.
 *
 * A separate hook rather than a changed return shape because five other
 * portals share useAttentionCounts and none of them has actors. Same rules:
 * failed polls keep the previous payload, errors are swallowed.
 */
export function useClientPortalCounts(endpoint: string): {
  counts: Record<string, number>;
  gate: ClientPortalGate | null;
} {
  const [state, setState] = React.useState<{
    counts: Record<string, number>;
    gate: ClientPortalGate | null;
  }>({ counts: {}, gate: null });

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(endpoint, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (cancelled || !body?.counts) return;
          setState({
            counts: body.counts as Record<string, number>,
            gate: body.portal ?? null,
          });
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [endpoint]);

  return state;
}
