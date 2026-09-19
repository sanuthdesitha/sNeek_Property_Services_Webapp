"use client";
import * as React from "react";
import Link from "next/link";
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
  return <section aria-label="Today's route" className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Today&apos;s route</h2><Link href="/v2/cleaner/route" className="inline-flex min-h-11 items-center underline">Open route controls</Link></div>
    <p className="text-sm text-[hsl(var(--e-muted-foreground))]">{orderState === "loading" ? "Checking saved route order…" : orderState === "saved" ? "Saved route order on this device. New stops follow at the end." : orderState === "unavailable" ? "Saved route order is unavailable. Stops below follow planned start times." : "Stops follow planned start times. Set your preferred order in route controls."} Travel times are not included.</p>
    {sorted.length === 0 ? <p className="text-sm">No accepted stops awaiting work today. Pending offers are shown separately below.</p> : <ol className="space-y-2">
      {sorted.map((stop, index) => <li key={stop.jobId} className="flex items-start gap-3 border-t border-[hsl(var(--e-border))] pt-3">
        <span aria-hidden="true" className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-surface-raised))] text-xs">{index + 1}</span>
        <div className="min-w-0 flex-1"><Link className="inline-flex min-h-11 items-center font-medium underline" href={`/v2/cleaner/jobs/${encodeURIComponent(stop.jobId)}`}>{stop.property}</Link><p className="break-words text-sm">{stop.address}</p><p className="text-xs text-[hsl(var(--e-muted-foreground))]">{stop.startTime ? `Planned start ${stop.startTime}` : "Start time to be confirmed"} · {stop.status.toLowerCase().replace(/_/g, " ")}</p></div>
        {stop.address ? <a className="inline-flex min-h-11 shrink-0 items-center text-sm underline" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`} target="_blank" rel="noreferrer">Directions</a> : null}
      </li>)}
    </ol>}
  </section>;
}
