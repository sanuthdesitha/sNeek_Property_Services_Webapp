"use client";

/**
 * ESTATE properties portfolio — v2-native replacement for the v1 properties
 * page. Client-side search / suburb filter over server-fetched rows, Estate
 * property cards, and a List/Map toggle where "Map" is an EClassicLink to the
 * classic map desk (no Google map mount in Estate). Same data as v1.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Bath, Bed, Building2, MapPin, RefreshCw, Search } from "lucide-react";
import { EBadge, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EClassicLink, EInput, ESelect } from "@/components/v2/admin/estate-kit";

export type EstatePropertyRow = {
  id: string;
  name: string;
  suburb: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  imageUrl: string | null;
  clientName: string;
  jobCount: number;
  hasIcal: boolean;
  icalSyncStatus: string | null;
  hasCoords: boolean;
};

const SYNC_TONE: Record<string, "success" | "danger" | "info" | "neutral"> = {
  SUCCESS: "success",
  ERROR: "danger",
  SYNCING: "info",
  IDLE: "neutral",
};

export function PropertiesPortfolio({ rows }: { rows: EstatePropertyRow[] }) {
  const [search, setSearch] = useState("");
  const [suburb, setSuburb] = useState("all");
  const [view, setView] = useState<"list" | "map">("list");

  const suburbs = useMemo(
    () => Array.from(new Set(rows.map((r) => r.suburb).filter(Boolean))).sort(),
    [rows],
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      clients: new Set(rows.map((r) => r.clientName)).size,
      ical: rows.filter((r) => r.hasIcal).length,
      jobs: rows.reduce((s, r) => s + r.jobCount, 0),
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (suburb !== "all" && r.suburb !== suburb) return false;
      if (q && !`${r.name} ${r.suburb} ${r.address} ${r.clientName}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, search, suburb]);

  const mapCount = rows.filter((r) => r.hasCoords).length;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Active properties" value={stats.total} icon={<Building2 className="h-4 w-4" />} />
        <EStatCard label="Clients" value={stats.clients} icon={<MapPin className="h-4 w-4" />} />
        <EStatCard label="iCal linked" value={stats.ical} icon={<RefreshCw className="h-4 w-4" />} />
        <EStatCard label="Jobs (all time)" value={stats.jobs} icon={<Building2 className="h-4 w-4" />} />
      </section>

      {/* Toolbar */}
      <ECard className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput
            className="pl-9"
            placeholder="Search name, suburb, address or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ESelect value={suburb} onChange={(e) => setSuburb(e.target.value)}>
          <option value="all">All suburbs</option>
          {suburbs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </ESelect>
        <div className="inline-flex items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-current={view === "list" ? "page" : undefined}
            className={
              "rounded-[var(--e-radius-sm)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors " +
              (view === "list"
                ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
            }
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setView("map")}
            aria-current={view === "map" ? "page" : undefined}
            className={
              "rounded-[var(--e-radius-sm)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors " +
              (view === "map"
                ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
            }
          >
            Map ({mapCount})
          </button>
        </div>
      </ECard>

      {view === "map" ? (
        <ECard className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
            <MapPin className="h-5 w-5" />
          </span>
          <p className="e-display-sm">Map view</p>
          <p className="max-w-sm text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {mapCount} of {rows.length} properties are geocoded. The interactive map lives in the classic
            properties desk.
          </p>
          <div className="mt-1">
            <EClassicLink href="/admin/properties">Open map in classic view</EClassicLink>
          </div>
        </ECard>
      ) : filtered.length === 0 ? (
        <ECard className="p-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No properties match these filters.
        </ECard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((prop) => (
            <Link
              key={prop.id}
              href={`/v2/admin/properties/${prop.id}`}
              className="group flex flex-col overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] transition-[transform,border-color,box-shadow] duration-[160ms] hover:-translate-y-0.5 hover:border-[hsl(var(--e-border-gold)/0.5)] hover:shadow-[var(--e-elevation-1)]"
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-[hsl(var(--e-surface-sunken))]">
                {prop.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={prop.imageUrl}
                    alt={prop.name}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--e-gold-soft))]">
                    <Building2 className="h-10 w-10 text-[hsl(var(--e-gold-ink)/0.4)]" />
                  </div>
                )}
                {prop.hasIcal ? (
                  <span className="absolute left-2 top-2">
                    <EBadge tone={SYNC_TONE[prop.icalSyncStatus ?? "IDLE"] ?? "neutral"} soft>
                      <RefreshCw className="h-2.5 w-2.5" /> iCal
                    </EBadge>
                  </span>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate font-[550] text-[hsl(var(--e-foreground))]">{prop.name}</h3>
                  <EBadge tone="success" soft>
                    Active
                  </EBadge>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {prop.suburb}
                  <span className="text-[hsl(var(--e-text-faint))]">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Bed className="h-3 w-3" /> {prop.bedrooms}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Bath className="h-3 w-3" /> {prop.bathrooms}
                  </span>
                </p>

                <div className="my-3 border-t border-[hsl(var(--e-border))]" />

                <div className="mt-auto flex items-center justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate text-[hsl(var(--e-muted-foreground))]">
                    Client{" "}
                    <span className="font-[550] text-[hsl(var(--e-foreground))]">{prop.clientName}</span>
                  </span>
                  <span className="shrink-0 text-[hsl(var(--e-muted-foreground))]">
                    Jobs{" "}
                    <span className="e-numeral font-semibold text-[hsl(var(--e-foreground))]">
                      {prop.jobCount}
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
