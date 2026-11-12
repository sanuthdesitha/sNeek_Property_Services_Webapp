/**
 * Laundry portal Today: the route in order with planned times (board 1
 * "Today"). Server-rendered, no client state: every stop links to its stop
 * screen; the one primary action goes to the current stop.
 */
import Link from "next/link";
import { Check, Map as MapIcon, Pencil } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";
import { stopHref } from "@/lib/laundry/office-request-types";
import { remainingAddresses, type TodayStop } from "@/lib/laundry/today-stops";
import type { TodayRoute } from "@/lib/laundry/today-route";

function StopNumber({ stop }: { stop: TodayStop }) {
  const base = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-[600]";
  if (stop.state === "done") return <span className={`${base} bg-[hsl(var(--e-success))] text-white`} aria-label="Done"><Check className="h-3.5 w-3.5" aria-hidden /></span>;
  if (stop.state === "now") return <span className={`${base} bg-[hsl(var(--e-gold,var(--e-warning)))] text-[hsl(40_35%_14%)]`}>{stop.number}</span>;
  return <span className={`${base} bg-[hsl(var(--e-surface-sunken,var(--e-muted)))] text-[hsl(var(--e-text-secondary))]`}>{stop.number}</span>;
}

function StopRow({ stop }: { stop: TodayStop }) {
  const tone = stop.tone === "warn" ? "text-[hsl(var(--e-warning))]" : stop.tone === "ok" ? "text-[hsl(var(--e-success))]" : "text-[hsl(var(--e-muted-foreground))]";
  return (
    <li className={`border-t border-[hsl(var(--e-border))] first:border-t-0 ${stop.state === "now" ? "bg-[hsl(var(--e-gold,var(--e-warning))/0.12)]" : ""}`}>
      <Link href={stopHref(stop.taskId, stop.kind)} className="flex min-h-[52px] items-start gap-2.5 px-3 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2">
        <StopNumber stop={stop} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <b className="min-w-0 break-words text-[0.875rem] font-[600]">{stop.kind === "PICKUP" ? "Pickup" : "Drop"} · {stop.propertyName}</b>
            <span className="shrink-0 text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">{stop.plannedTime ?? "No time"}</span>
          </span>
          <span className={`block text-[0.75rem] ${tone}`}>{stop.line}</span>
        </span>
      </Link>
    </li>
  );
}

export function TodayRouteList({ route }: { route: TodayRoute | null }) {
  if (route === null) {
    return (
      <ECard className="p-4">
        <p role="alert">Today&apos;s route is unavailable.</p>
        <EButton asChild className="mt-3"><a href="/v2/laundry">Retry route</a></EButton>
      </ECard>
    );
  }
  const current = route.stops.find((stop) => stop.state === "now") ?? null;
  const maps = buildGoogleMapsMultiStopUrl(remainingAddresses(route.stops), { fromCurrentLocation: true });
  return (
    <section aria-labelledby="today-route" className="space-y-2">
      <h2 id="today-route" className="sr-only">Today&apos;s stops</h2>
      {route.mode === "draft" ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-warning))]">Your route draft is waiting: it has not been started. <Link className="font-[600] underline" href="/v2/laundry/route">Resume draft route</Link></p>
      ) : null}
      {route.mode === "none" ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No route yet. These are today&apos;s stops by planned time. <Link className="font-[600] text-[hsl(var(--e-accent-portal))] underline" href="/v2/laundry/route">Build route</Link></p>
      ) : null}
      {route.otherDayStops > 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {route.otherDayStops} stop{route.otherDayStops === 1 ? " on your route is" : "s on your route are"} not scheduled today, so {route.otherDayStops === 1 ? "it is" : "they are"} not listed here.{" "}
          <Link className="font-[600] text-[hsl(var(--e-accent-portal))] underline" href="/v2/laundry/tracking">See them in Tracking</Link>
        </p>
      ) : null}
      {route.stops.length === 0 ? (
        <ECard className="p-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No stops for today.</ECard>
      ) : (
        <ECard className="overflow-hidden p-0"><ol>{route.stops.map((stop) => <StopRow key={`${stop.taskId}:${stop.kind}`} stop={stop} />)}</ol></ECard>
      )}
      <div className="grid grid-cols-2 gap-2">
        <EButton asChild variant="outline" className="min-h-11"><Link href="/v2/laundry/route"><Pencil className="h-4 w-4" /> Edit route order</Link></EButton>
        {maps ? (
          <EButton asChild variant="outline" className="min-h-11"><a href={maps} target="_blank" rel="noreferrer"><MapIcon className="h-4 w-4" /> Open in Maps</a></EButton>
        ) : (
          <EButton variant="outline" className="min-h-11" disabled title="No stop has an address">Open in Maps</EButton>
        )}
      </div>
      {current ? (
        <EButton asChild className="min-h-12 w-full justify-center text-[0.9375rem]">
          <Link href={stopHref(current.taskId, current.kind)}>Go to stop {current.number} · {current.propertyName}</Link>
        </EButton>
      ) : route.stops.length ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-success))]">All stops done.</p> : null}
    </section>
  );
}
