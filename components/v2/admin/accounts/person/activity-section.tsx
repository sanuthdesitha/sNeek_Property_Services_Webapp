"use client";

/**
 * Activity tab: audit rows and notices for this account
 * (`GET /api/admin/users/[id]/activity`), newest first, in the organisation's
 * timezone. Loading, failure and empty are separate states; a read for a
 * previous person is aborted and never shown.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { formatDateTime } from "../hub/account-display";

type ActivityItem = { id: string; type: string; title: string; body: string | null; createdAt: string };
type ActivityState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: ActivityItem[] };

export function ActivitySection({ userId }: { userId: string }) {
  const [state, setState] = useState<ActivityState>({ status: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/admin/users/${encodeURIComponent(userId)}/activity`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { items?: ActivityItem[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error ?? `Could not load activity (${res.status}).`);
        setState({ status: "ready", items: body.items });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: reason instanceof Error ? reason.message : "Could not load activity." });
      });
    return () => controller.abort();
  }, [userId, revision]);

  return (
    <section aria-label="Account activity" className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">Activity</h3>
      {state.status === "loading" ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading activity…</p> : null}
      {state.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
          <span className="text-[hsl(var(--e-danger))]">{state.message}</span>
          <EButton size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Try again</EButton>
        </div>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No recorded activity yet.</p> : null}
      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="space-y-2.5">
          {state.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5 border-b border-[hsl(var(--e-border)/0.7)] pb-2.5 last:border-b-0 last:pb-0">
              <EPill tone={item.type === "NOTIFICATION" ? "info" : "neutral"}>{item.type === "NOTIFICATION" ? "Notice" : "Audit"}</EPill>
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] font-[550] [overflow-wrap:anywhere]">{item.title}</p>
                {item.body ? <p className="line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{item.body}</p> : null}
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{formatDateTime(item.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
