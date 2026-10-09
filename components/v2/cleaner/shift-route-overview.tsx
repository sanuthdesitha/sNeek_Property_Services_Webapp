"use client";
import * as React from "react";
import Link from "next/link";
import { Route, ArrowUpRight } from "lucide-react";
import { orderStorageKey, applyStoredOrder } from "@/lib/cleaner/route-order";
import type { ShiftRouteStop } from "@/lib/cleaner/shift";

export function ShiftRouteOverview(props: { stops: ShiftRouteStop[]; userId: string; day: string }) {
  return <Overview key={`${props.userId}:${props.day}`} {...props} />;
}
function Overview({ stops, userId, day }: { stops: ShiftRouteStop[]; userId: string; day: string }) {
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [orderState, setOrderState] = React.useState<"loading" | "saved" | "schedule" | "unavailable">("loading");
  React.useEffect(() => {
    const key = orderStorageKey(userId, day);
    function load() {
      try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw === null ? null : JSON.parse(raw);
        if (parsed !== null && (!Array.isArray(parsed) || parsed.some(id => typeof id !== "string"))) throw new Error();
        setOrder(parsed); setOrderState(parsed?.length ? "saved" : "schedule");
      } catch { setOrder(null); setOrderState("unavailable"); }
    }
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === key) load(); };
    load(); window.addEventListener("storage", changed); window.addEventListener("focus", load);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", load); };
  }, [userId, day]);
  const sorted = applyStoredOrder([...stops].sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99") || a.jobId.localeCompare(b.jobId)), order);
  const next = sorted[0];
  return <section aria-label="Today's route" className="flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
    <Route className="h-5 w-5 shrink-0 text-[hsl(var(--e-gold-ink))]" aria-hidden />
    <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Today&apos;s route · {sorted.length} {sorted.length === 1 ? "stop" : "stops"}</h2>
      <p className="truncate text-xs text-[hsl(var(--e-muted-foreground))]">{orderState === "loading" ? "Loading your order…" : next ? `Next: ${next.property}${next.startTime ? ` · ${next.startTime}` : ""}` : "No accepted stops remaining"}</p>
      {orderState === "unavailable" ? <p className="text-xs">Saved order unavailable; showing schedule order.</p> : null}
    </div>
    <Link href="/v2/cleaner/route" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium">Open route <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
  </section>;
}
