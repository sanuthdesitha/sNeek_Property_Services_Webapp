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
import { useSession } from "next-auth/react";

const REFRESH_MS = 60_000;

export function useAttentionCounts(endpoint: string): Record<string, number> {
  const { data: session, status } = useSession();
  const identity = status === "authenticated" && session?.user?.id
    ? JSON.stringify([endpoint, session.user.id, session.user.role, session.impersonation?.actorId,
        session.impersonation?.mode, session.impersonation?.startedAt]) : "";
  const [state, setState] = React.useState<{ identity: string; counts: Record<string, number> }>({ identity: "", counts: {} });
  React.useEffect(() => {
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    if (!identity) return;
    const load = async () => {
      if (cancelled || pending) return;
      pending = true;
      try {
        const res = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setState({ identity, counts: {} });
          return;
        }
        if (!res.ok) return;
        const body = await res.json();
        if (!body?.counts || typeof body.counts !== "object" || Array.isArray(body.counts)) return;
        const counts: Record<string, number> = {};
        for (const [href, count] of Object.entries(body.counts)) {
          if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) counts[href] = count;
        }
        if (!cancelled) setState({ identity, counts });
      } catch { /* Transient failure retains only this identity's previous counts. */ }
      finally { pending = false; }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    window.addEventListener("sneek:notification", load);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("sneek:notification", load);
    };
  }, [endpoint, identity]);
  return identity && state.identity === identity ? state.counts : {};
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
  /** Set only for a VA: the client whose account they are working in. */
  actingFor?: string | null;
  /** Set only for a VA: which of that client's teams they belong to. */
  teamName?: string | null;
}

/**
 * Client-portal variant: counts PLUS the actor/permissions the API resolved.
 *
 * A separate hook rather than a changed return shape because five other
 * portals share useAttentionCounts and none of them has actors. Transient errors
 * may retain counts, but never grants; denied access clears both. Identity
 * changes discard prior results synchronously and cancel outstanding requests.
 */
export function useClientPortalCounts(endpoint: string, identity = endpoint): {
  counts: Record<string, number>;
  gate: ClientPortalGate | null;
  status: "loading" | "ready" | "unavailable" | "denied";
  refresh: () => void;
} {
  const [state, setState] = React.useState<{
    identity: string;
    counts: Record<string, number>;
    gate: ClientPortalGate | null;
    status: "loading" | "ready" | "unavailable" | "denied";
  }>({ identity, counts: {}, gate: null, status: "loading" });
  const refreshRef = React.useRef<() => void>(() => {});
  const refresh = React.useCallback(() => refreshRef.current(), []);

  React.useEffect(() => {
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    setState({ identity, counts: {}, gate: null, status: "loading" });
    const fail = (status: "unavailable" | "denied") => {
      if (cancelled) return;
      setState((previous) => ({
        identity,
        counts: status === "denied" || previous.identity !== identity ? {} : previous.counts,
        gate: null,
        status,
      }));
    };
    const load = async () => {
      if (pending || cancelled || !identity) return;
      pending = true;
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (response.status === 401 || response.status === 403) { fail("denied"); return; }
        if (!response.ok) { fail("unavailable"); return; }
        const body = await response.json();
        const portal = body?.portal;
        if (!body?.counts || typeof body.counts !== "object" || Array.isArray(body.counts) ||
            !portal || !["CLIENT", "VA"].includes(portal.actor) ||
            !portal.permissions || typeof portal.permissions !== "object" || Array.isArray(portal.permissions)) {
          fail("unavailable"); return;
        }
        const counts = Object.fromEntries(Object.entries(body.counts).filter(([, count]) =>
          typeof count === "number" && Number.isSafeInteger(count) && count >= 0
        )) as Record<string, number>;
        const permissions = Object.fromEntries(Object.entries(portal.permissions).map(([key, value]) => [key, value === true]));
        if (!cancelled) setState({ identity, counts, status: "ready", gate: {
          actor: portal.actor, permissions,
          actingFor: typeof portal.actingFor === "string" ? portal.actingFor : null,
          teamName: typeof portal.teamName === "string" ? portal.teamName : null,
        } });
      } catch { fail("unavailable"); }
      finally { pending = false; }
    };
    refreshRef.current = () => { void load(); };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      controller.abort();
      refreshRef.current = () => {};
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [endpoint, identity]);

  return state.identity === identity
    ? { ...state, refresh }
    : { counts: {}, gate: null, status: "loading", refresh };
}
