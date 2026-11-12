"use client";

/**
 * The Cards and Map views. Cards are the old portfolio cards (cover photo,
 * key lost, client, jobs) over the same server page as the table, so search,
 * filters, sort and paging apply alike. Map stays what it was: how many of
 * the listed properties have a map position, with the live ops map one click
 * away (the admin has no embedded map of its own).
 */
import { Bath, Bed, Building2, MapPin } from "lucide-react";
import { ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EClassicLink } from "@/components/v2/admin/estate-kit";
import type { PortfolioRow } from "@/lib/properties/portfolio-options";
import { CalendarCell, FlagsCell } from "./portfolio-columns";

export function PortfolioCards({ rows, now, activeId, onOpen }: { rows: PortfolioRow[]; now: Date; activeId: string | null; onOpen: (row: PortfolioRow) => void }) {
  if (rows.length === 0) {
    return <ECard className="p-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No properties match these filters.</ECard>;
  }
  return (
    <ul aria-label="Properties" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onOpen(row)}
            aria-label={`Open ${row.name}`}
            aria-current={activeId === row.id ? "true" : undefined}
            className="group flex w-full flex-col overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-left transition-[border-color,box-shadow] hover:border-[hsl(var(--e-border-gold)/0.5)] hover:shadow-[var(--e-elevation-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] aria-[current=true]:border-[hsl(var(--e-primary))]"
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-[hsl(var(--e-surface-sunken))]">
              {row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--e-gold-soft))]">
                  <Building2 aria-hidden className="h-10 w-10 text-[hsl(var(--e-gold-ink)/0.4)]" />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate font-[600]">{row.name}</span>
                {row.oneOff ? <EPill>One-off site</EPill> : null}
              </div>
              <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {row.suburb} · {row.clientName}
                <span className="inline-flex items-center gap-1"><Bed aria-hidden className="h-3 w-3" /> {row.bedrooms}</span>
                <span className="inline-flex items-center gap-1"><Bath aria-hidden className="h-3 w-3" /> {row.bathrooms}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[0.75rem]">
                <CalendarCell row={row} now={now} />
                <FlagsCell row={row} />
              </div>
              <p className="mt-auto text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Jobs <span className="e-tnum font-[600] text-[hsl(var(--e-foreground))]">{row.jobCount}</span>
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PortfolioMap({ mapped, total }: { mapped: number; total: number }) {
  return (
    <ECard className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
        <MapPin aria-hidden className="h-5 w-5" />
      </span>
      <h2 className="e-display-sm">Map view</h2>
      <p className="max-w-sm text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        {mapped} of {total} listed properties have a map position. See them live on the ops map.
      </p>
      <EClassicLink href="/v2/admin/ops/map">Open the ops map</EClassicLink>
    </ECard>
  );
}
