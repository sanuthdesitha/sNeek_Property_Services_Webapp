"use client";

/**
 * ESTATE laundry Live tab (office): where the drivers are and what is in
 * transit, from GET /api/admin/laundry/live (polled every 15 s while visible).
 *
 * It used to embed the DRIVER's route screen, which loaded the viewer's own
 * route (none, for the office) and offered the office "Share GPS"; the drivers
 * appeared only as a count. Now: a map of every driver with an active route
 * today (age colours, accuracy rings, the selected driver's stops) and a list
 * with the age of each fix and what the phone reported.
 *
 * Reads abort the previous one and are applied only if still current; a failed
 * refresh keeps the last snapshot marked stale with Retry; an empty list is
 * only shown after a successful read.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { PackageCheck, RefreshCw, Truck, AlertTriangle, Phone } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { formatRelativeAgo } from "@/lib/ops/live-status";
import { isApproximateFix, locationFreshness, trackingStateLabel } from "@/lib/gps/staleness";
import { LaundryDriverMap, type OfficeDriver } from "./laundry-driver-map";

type LiveTask = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  pickedUpAt: string | null;
  droppedAt: string | null;
  flagReason: string | null;
  property?: { id: string; name: string | null; suburb: string | null; address: string | null } | null;
};

type OverdueTask = {
  id: string;
  pickedUpAt: string | null;
  dropoffDate: string | null;
  property?: { name: string | null; suburb: string | null } | null;
};

type LiveSnapshot = {
  now: string;
  maxOutdoorDays: number;
  drivers: OfficeDriver[];
  tasks: LiveTask[];
  overdueAtLaundry: OverdueTask[];
};

type LoadState = { snapshot: LiveSnapshot | null; status: "loading" | "ready" | "error"; updatedAt: number | null };

const POLL_MS = 15_000;

function propertyLine(p?: { name?: string | null; suburb?: string | null } | null) {
  const name = p?.name ?? "Property";
  const suburb = p?.suburb ?? "";
  return suburb ? `${name}, ${suburb}` : name;
}

function parseSnapshot(body: unknown): LiveSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Partial<LiveSnapshot>;
  if (!Array.isArray(value.drivers) || !Array.isArray(value.tasks) || !Array.isArray(value.overdueAtLaundry)) return null;
  return value as LiveSnapshot;
}

function DriverRow({ driver, selected, onSelect }: { driver: OfficeDriver; selected: boolean; onSelect: () => void }) {
  const freshness = locationFreshness(driver.timestamp);
  const reason = trackingStateLabel(driver.trackingState);
  const tone = freshness === "live" ? "success" : freshness === "aging" ? "warning" : "danger";
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 py-2.5">
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-info))]">
          <Truck className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="block text-[0.9375rem] font-[550]">{driver.user.name ?? "Driver"}</span>
          <span className="block text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {driver.stopsDone} of {driver.stopsTotal} stops done ·{" "}
            {driver.timestamp ? `last fix ${formatRelativeAgo(driver.timestamp)}${driver.accuracy != null ? ` · ±${Math.round(driver.accuracy)} m` : ""}` : "no GPS yet"}
            {isApproximateFix(driver.accuracy) ? " · approximate" : ""}
          </span>
          {reason ? <span className="block text-[0.75rem] text-[hsl(var(--e-danger))]">Phone reports: {reason}</span> : null}
        </span>
      </button>
      <EBadge tone={driver.timestamp ? tone : "neutral"} soft>
        {driver.timestamp ? (freshness === "live" ? "Live" : freshness === "aging" ? "Aging" : "Stale") : "No GPS"}
      </EBadge>
      {driver.phone ? (
        <EButton asChild size="sm" variant="ghost"><a href={`tel:${driver.phone}`}><Phone className="h-3.5 w-3.5" aria-hidden />Call</a></EButton>
      ) : null}
    </li>
  );
}

export function LaundryLive({ timeZone = "Australia/Sydney" }: { timeZone?: string }) {
  const [state, setState] = React.useState<LoadState>({ snapshot: null, status: "loading", updatedAt: null });
  const [selected, setSelected] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const request = ++sequence.current;
    setState((previous) => ({ ...previous, status: previous.snapshot ? previous.status : "loading" }));
    try {
      const res = await fetch("/api/admin/laundry/live", { cache: "no-store", signal: current.signal, headers: { "x-progress-toast": "off" } });
      if (!res.ok) throw new Error(String(res.status));
      const snapshot = parseSnapshot(await res.json());
      if (current.signal.aborted || request !== sequence.current) return;
      if (!snapshot) throw new Error("Unexpected response");
      setState({ snapshot, status: "ready", updatedAt: Date.now() });
    } catch {
      if (current.signal.aborted || request !== sequence.current) return;
      setState((previous) => ({ ...previous, status: "error" }));
    }
  }, []);

  React.useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      controller.current?.abort();
    };
  }, [load]);

  const snapshot = state.snapshot;
  const drivers = snapshot?.drivers ?? [];
  const inTransit = (snapshot?.tasks ?? []).filter((t) => t.status === "PICKED_UP" || t.status === "READY_TO_RETURN");
  const overdue = snapshot?.overdueAtLaundry ?? [];
  const format = (iso: string, pattern: string) => formatInTimeZone(new Date(iso), timeZone, pattern);

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label="Laundry drivers">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="e-eyebrow">DRIVERS ON A ROUTE TODAY</span>
          <div className="flex flex-wrap items-center gap-2">
            {snapshot ? <EBadge tone={drivers.length > 0 ? "success" : "neutral"} soft>{drivers.length} driver{drivers.length === 1 ? "" : "s"} on a route</EBadge> : null}
            <EButton variant="outline" size="sm" onClick={() => void load()} disabled={state.status === "loading"}>
              <RefreshCw className={`h-3.5 w-3.5 ${state.status === "loading" ? "animate-spin" : ""}`} aria-hidden />
              Refresh
            </EButton>
          </div>
        </div>
        {state.status === "error" ? (
          <p role="status" className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
            {snapshot && state.updatedAt
              ? `Could not refresh. Showing the snapshot from ${formatInTimeZone(new Date(state.updatedAt), timeZone, "HH:mm")}.`
              : "The live laundry view could not be loaded."}
            <button type="button" className="underline" onClick={() => void load()}>Retry</button>
          </p>
        ) : null}
        <ECard>
          <LaundryDriverMap drivers={drivers} selectedUserId={selected} onSelect={setSelected} />
          <ECardBody className="pt-0">
            {!snapshot ? (
              <p role="status" className="py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{state.status === "error" ? "No driver data." : "Loading drivers…"}</p>
            ) : drivers.length === 0 ? (
              <p className="py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No driver has an active route today. Drivers are only located while their route is active.</p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {drivers.map((driver) => (
                  <DriverRow key={driver.userId} driver={driver} selected={selected === driver.userId} onSelect={() => setSelected((current) => (current === driver.userId ? null : driver.userId))} />
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>
      </section>

      <section className="space-y-3" aria-label="In transit">
        <span className="e-eyebrow">IN TRANSIT · PICKED UP</span>
        {!snapshot ? null : inTransit.length === 0 ? (
          <EEmptyState eyebrow="Clear" title="Nothing in transit" description="No loads are currently picked up and en route to drop-off." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {inTransit.map((t) => (
              <ECard key={t.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-info))]">
                    <Truck className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-[550]">{propertyLine(t.property)}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Picked up {t.pickedUpAt ? format(t.pickedUpAt, "d MMM, HH:mm") : "—"} · drop-off due {formatInTimeZone(new Date(t.dropoffDate), "UTC", "d MMM")}
                    </p>
                  </div>
                  <EBadge tone="info" soft>En route</EBadge>
                </ECardBody>
              </ECard>
            ))}
          </div>
        )}
      </section>

      {overdue.length > 0 ? (
        <section className="space-y-3" aria-label="Overdue at the laundromat">
          <span className="e-eyebrow">OVERDUE AT LAUNDROMAT ({snapshot?.maxOutdoorDays ?? 3}+ DAYS)</span>
          <div className="space-y-2">
            {overdue.map((t) => (
              <ECard key={t.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-danger))]">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-[550]">{propertyLine(t.property)}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Picked up {t.pickedUpAt ? format(t.pickedUpAt, "d MMM") : "—"} · still not returned
                    </p>
                  </div>
                  <EBadge tone="danger" soft>
                    <PackageCheck className="h-2.5 w-2.5" aria-hidden /> Chase return
                  </EBadge>
                </ECardBody>
              </ECard>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
