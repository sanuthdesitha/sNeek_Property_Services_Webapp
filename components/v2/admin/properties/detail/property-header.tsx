"use client";

/**
 * Property page header and key facts as drawn: back link, name with its
 * state, the address / client / times line, then "Sync calendar now", the
 * primary "New job here" (the New job form pre-filled with this property)
 * and More (Copy as new property, Edit form fields, Deactivate with PIN or
 * password). Key facts below: rooms, jobs, reservations, last clean, rating,
 * lifetime value — each "–" or "None yet" when there is nothing to show.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { formatCurrency } from "@/lib/utils";
import { sydneyRelativeDayLabel } from "@/lib/jobs/date-grouping";
import { jobHref, newJobHref } from "@/lib/properties/links";
import type { PropertyOverview } from "@/lib/properties/preview-types";
import { PropertyMoreMenu } from "../property-more-menu";
import type { PropertyRecord } from "./property-record";
import type { PropertyStatsDto, Remote } from "./use-property-summaries";

export function PropertyHeader({
  property,
  syncing,
  onSync,
}: {
  property: PropertyRecord;
  syncing: boolean;
  onSync: () => void;
}) {
  const router = useRouter();
  const linked = Boolean(property.integration?.isEnabled && property.integration.icalUrl);
  const address = property.address ?? "";
  const place = [address, property.suburb && !address.includes(property.suburb) ? property.suburb : null].filter(Boolean).join(", ");
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Link href="/v2/admin/properties" className="text-[0.8125rem] text-[hsl(var(--e-primary))] hover:underline">← Properties</Link>
        <h1 className="e-display-md mt-1 break-words">
          {property.name}{" "}
          <EPill tone={property.isActive ? "ok" : "neutral"} className="align-middle">{property.isActive ? "Active" : "Deactivated"}</EPill>
          {property.keyLostMode ? <EPill tone="bad" className="ml-1 align-middle">Key lost mode</EPill> : null}
        </h1>
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {place}
          {property.client ? <> · <Link className="underline" href={`/v2/admin/clients/${encodeURIComponent(property.client.id)}`}>{property.client.name}</Link></> : null}
          {` · check-in ${property.defaultCheckinTime ?? "not set"}, checkout ${property.defaultCheckoutTime ?? "not set"}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {linked ? (
          <EButton variant="outline" size="sm" onClick={onSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync calendar now"}</EButton>
        ) : null}
        <EButton asChild size="sm">
          <Link href={newJobHref(property.id)}>New job here</Link>
        </EButton>
        <PropertyMoreMenu
          propertyId={property.id}
          propertyName={property.name}
          includeNewJob={false}
          trigger={<span className="px-1 text-[0.8125rem] font-[550]">More ▾</span>}
          onArchived={() => {
            router.push("/v2/admin/properties");
            router.refresh();
          }}
        />
      </div>
    </header>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[7.5rem] flex-1 rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2">
      <p className="mb-0.5 text-[0.75rem] font-[500] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <div className="e-tnum text-[0.875rem] font-[600]">{children}</div>
    </div>
  );
}

export function PropertyKeyFacts({ property, overview, stats }: { property: PropertyRecord; overview: Remote<PropertyOverview>; stats: Remote<PropertyStatsDto> }) {
  const last = overview.data?.lastClean ?? null;
  const rating = stats.data?.averageJobRating ?? null;
  return (
    <section aria-label="Key facts" className="flex flex-wrap items-stretch gap-2">
      <Fact label="Bedrooms">{property.bedrooms}</Fact>
      <Fact label="Bathrooms">{property.bathrooms}</Fact>
      <Fact label="Sofa beds">{property.sofaBedCount}</Fact>
      <Fact label="Jobs, all time">{property._count?.jobs ?? "–"}</Fact>
      <Fact label="Reservations">{property._count?.reservations ?? "–"}</Fact>
      <Fact label="Last clean">
        {overview.data ? (
          last ? <>{sydneyRelativeDayLabel(last.dayKey)} <Link className="font-[400] text-[hsl(var(--e-muted-foreground))] underline" href={jobHref(last.jobId)}>{last.jobNumber}</Link></> : "None yet"
        ) : "–"}
      </Fact>
      <Fact label="Avg rating">
        {stats.data ? (rating === null ? <span className="font-[400] text-[hsl(var(--e-muted-foreground))]">Not rated</span> : `${rating.toFixed(1)}`) : "–"}
      </Fact>
      <Fact label="Lifetime value">
        {stats.data ? <span title="Paid invoice lines only">{formatCurrency(stats.data.lifetimeValue)}</span> : "–"}
      </Fact>
    </section>
  );
}
