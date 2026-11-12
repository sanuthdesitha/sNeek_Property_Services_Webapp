"use client";

/**
 * How many office "Can you buy these?" asks are waiting for this cleaner's
 * answer. Drives the Supplies tab badge (board: "Supplies 2").
 *
 * Reads the existing cleaner asks endpoint; one read on mount, on focus and
 * every two minutes. A failed or pending read reports zero, so the tab shows no
 * badge rather than a wrong number — Supplies → To do still lists the asks.
 */
import * as React from "react";
import { useSession } from "next-auth/react";
import { countWaitingAsks } from "@/components/v2/cleaner/portal/tab-badges";

const REFRESH_MS = 120_000;

export function useOpenAskCount(): number {
  const { data: session, status } = useSession();
  const identity = status === "authenticated" && session?.user?.role === "CLEANER"
    ? JSON.stringify([session.user.id, session.impersonation?.actorId, session.impersonation?.startedAt])
    : "";
  const [state, setState] = React.useState<{ identity: string; count: number }>({ identity: "", count: 0 });

  React.useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (cancelled || pending) return;
      pending = true;
      try {
        const response = await fetch("/api/cleaner/urgent-stock/asks", { cache: "no-store", signal: controller.signal });
        const body: unknown = response.ok ? await response.json() : null;
        if (cancelled) return;
        setState({ identity, count: countWaitingAsks(body) ?? 0 });
      } catch {
        if (!cancelled) setState({ identity, count: 0 });
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [identity]);

  return identity && state.identity === identity ? state.count : 0;
}
