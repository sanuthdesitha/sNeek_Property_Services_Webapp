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
import { useSession } from "next-auth/react";

export interface MaintenanceSectionState {
  /** True only when the signed-in user holds at least one open assignment. */
  assigned: boolean;
  /** How many open maintenance items they are on — drives the nav badge. */
  count: number;
}

export function useMaintenanceSection(): MaintenanceSectionState {
  const { data: session, status } = useSession();
  const identity = status === "authenticated" && session?.user?.id
    ? JSON.stringify([session.user.id, session.user.role, session.impersonation?.actorId,
        session.impersonation?.mode, session.impersonation?.startedAt]) : "";
  const [state, setState] = React.useState<MaintenanceSectionState & { identity: string }>({ identity: "", assigned: false, count: 0 });

  React.useEffect(() => {
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    if (!identity) return;
    const load = async () => {
      if (cancelled || pending) return;
      pending = true;
      try {
        const res = await fetch("/api/maintenance/assigned/summary", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error("Assignment unavailable");
        const body: unknown = await res.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid assignment");
        const value = body as Record<string, unknown>;
        if (typeof value.assigned !== "boolean" || !Number.isSafeInteger(value.count) || (value.count as number) < 0) throw new Error("Invalid assignment");
        if (!cancelled) setState({ identity, assigned: value.assigned, count: value.assigned ? value.count as number : 0 });
      } catch {
        if (!cancelled) setState({ identity, assigned: false, count: 0 });
      } finally {
        pending = false;
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [identity]);

  return identity && state.identity === identity ? { assigned: state.assigned, count: state.count } : { assigned: false, count: 0 };
}
