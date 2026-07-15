"use client";

/**
 * ESTATE laundry Live tab — pairs the shared v2 LaundryRouteMap (today's route +
 * live GPS share) with in-transit task cards fed by GET /api/admin/laundry/live
 * (the same snapshot the v1 AdminLaundryLive view polls): picked-up loads en
 * route to drop-off, plus loads overdue at the laundromat. No components/ui/*.
 */
import * as React from "react";
import { format } from "date-fns";
import { PackageCheck, RefreshCw, Truck, AlertTriangle } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { LaundryRouteMap } from "@/components/v2/laundry/route-map";

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
  drivers: Array<{ userId: string; user?: { name: string | null } | null; timestamp: string }>;
  tasks: LiveTask[];
  overdueAtLaundry: OverdueTask[];
};

function propertyLine(p?: { name?: string | null; suburb?: string | null } | null) {
  const name = p?.name ?? "Property";
  const suburb = p?.suburb ?? "";
  return suburb ? `${name}, ${suburb}` : name;
}

export function LaundryLive() {
  const [snapshot, setSnapshot] = React.useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/admin/laundry/live", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setSnapshot(body as LiveSnapshot);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => void load({ silent: true }), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const inTransit = (snapshot?.tasks ?? []).filter((t) => t.status === "PICKED_UP");
  const overdue = snapshot?.overdueAtLaundry ?? [];
  const drivers = snapshot?.drivers ?? [];

  return (
    <div className="space-y-6">
      <LaundryRouteMap />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="e-eyebrow">IN TRANSIT · PICKED UP</span>
          <div className="flex items-center gap-2">
            <EBadge tone={drivers.length > 0 ? "success" : "neutral"} soft>
              {drivers.length} driver{drivers.length === 1 ? "" : "s"} live
            </EBadge>
            <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </EButton>
          </div>
        </div>

        {inTransit.length === 0 ? (
          <EEmptyState
            eyebrow="Clear"
            title="Nothing in transit"
            description={loading ? "Loading live loads…" : "No loads are currently picked up and en route to drop-off."}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {inTransit.map((t) => (
              <ECard key={t.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-info))]">
                    <Truck className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-[550]">{propertyLine(t.property)}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Picked up {t.pickedUpAt ? format(new Date(t.pickedUpAt), "d MMM, HH:mm") : "—"} · drop-off due{" "}
                      {format(new Date(t.dropoffDate), "d MMM")}
                    </p>
                  </div>
                  <EBadge tone="info" soft>
                    En route
                  </EBadge>
                </ECardBody>
              </ECard>
            ))}
          </div>
        )}
      </section>

      {overdue.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow">OVERDUE AT LAUNDROMAT ({snapshot?.maxOutdoorDays ?? 3}+ DAYS)</span>
          <div className="space-y-2">
            {overdue.map((t) => (
              <ECard key={t.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-danger))]">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-[550]">{propertyLine(t.property)}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Picked up {t.pickedUpAt ? format(new Date(t.pickedUpAt), "d MMM") : "—"} · still not returned
                    </p>
                  </div>
                  <EBadge tone="danger" soft>
                    <PackageCheck className="h-2.5 w-2.5" /> Chase return
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
