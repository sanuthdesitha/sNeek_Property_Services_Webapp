"use client";

/**
 * Step 1 / section 1: which property. Search, recent properties, the matches
 * (inactive ones listed and marked) and the chosen property's card, or a
 * one-off address that keeps today's service-site path.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EInput, ESelect, ETextarea, EField } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import { dayLabel, type NewJobDraft, type OneOffDraft } from "@/lib/jobs/new-job/draft";
import type { NewJobOptions, NewJobPropertyFacts, NewJobPropertyOption } from "@/lib/jobs/new-job/types";
import type { ReadState } from "./use-new-job-data";
import { ChoiceChip, Faint, Segmented } from "./new-job-ui";

type ClientOption = { id: string; name: string };

export type PropertySectionProps = {
  draft: NewJobDraft;
  options: ReadState<NewJobOptions>;
  facts: ReadState<NewJobPropertyFacts>;
  onChooseProperty: (propertyId: string) => void;
  onSiteMode: (mode: NewJobDraft["siteMode"]) => void;
  onOneOff: (patch: Partial<OneOffDraft>) => void;
  problemFields: ReadonlySet<string>;
  compact?: boolean;
};

function matches(property: NewJobPropertyOption, query: string): boolean {
  const text = `${property.name} ${property.address} ${property.suburb} ${property.clientName ?? ""}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

export function factsLine(facts: NewJobPropertyFacts): string {
  const p = facts.property;
  const parts = [`${p.bedrooms} bedroom${p.bedrooms === 1 ? "" : "s"}`, `${p.bathrooms} bathroom${p.bathrooms === 1 ? "" : "s"}`];
  if (p.sofaBedCount > 0) parts.push(`${p.sofaBedCount} sofa bed${p.sofaBedCount === 1 ? "" : "s"}`);
  if (p.hasBalcony) parts.push("balcony");
  if (p.laundryEnabled) {
    const who = facts.laundry.partnerNames.length ? facts.laundry.partnerNames.join(", ") : "no laundry partner set";
    const bag = facts.laundry.bagLabel ? `, ${facts.laundry.bagColor ? `${facts.laundry.bagColor} ` : ""}bag "${facts.laundry.bagLabel}"` : "";
    parts.push(`laundry on (${who}${bag})`);
  } else {
    parts.push("laundry off");
  }
  if (p.inventoryEnabled) parts.push("stock tracked");
  parts.push(facts.ical ? `iCal: ${facts.ical.enabled ? "on" : "off"}` : "no booking calendar");
  return parts.join(" · ");
}

function useClients(enabled: boolean): ClientOption[] {
  const [clients, setClients] = useState<ClientOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/admin/clients", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: unknown) => {
        if (controller.signal.aborted || !Array.isArray(data)) return;
        setClients(data.map((row: { id: string; name: string }) => ({ id: row.id, name: row.name })));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled]);
  return clients;
}

function OneOffFields({ draft, onOneOff, problemFields }: Pick<PropertySectionProps, "draft" | "onOneOff" | "problemFields">) {
  const site = draft.oneOff;
  const clients = useClients(true);
  const set = (key: keyof OneOffDraft) => (event: { target: { value: string } }) => onOneOff({ [key]: event.target.value } as Partial<OneOffDraft>);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Client (optional)">
          <ESelect value={site.clientId} onChange={set("clientId")}>
            <option value="">No linked client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </ESelect>
        </EField>
        <EField label="Site name">
          <EInput id="new-job-siteName" aria-invalid={problemFields.has("siteName") || undefined} value={site.siteName} onChange={set("siteName")} placeholder="Bondi Gym, Level 2" />
        </EField>
      </div>
      <EField label="Service address">
        <EAddressInput
          value={site.siteAddress}
          onChange={(text) => onOneOff({ siteAddress: text })}
          onSelect={(result) => onOneOff({ siteAddress: result.formattedAddress, siteSuburb: result.suburb ?? site.siteSuburb, siteState: result.state ?? site.siteState, sitePostcode: result.postcode ?? site.sitePostcode })}
        />
      </EField>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <EField label="Suburb"><EInput id="new-job-siteSuburb" aria-invalid={problemFields.has("siteSuburb") || undefined} value={site.siteSuburb} onChange={set("siteSuburb")} /></EField>
        <EField label="State"><EInput maxLength={3} value={site.siteState} onChange={(event) => onOneOff({ siteState: event.target.value.toUpperCase() })} /></EField>
        <EField label="Postcode"><EInput inputMode="numeric" maxLength={4} value={site.sitePostcode} onChange={set("sitePostcode")} /></EField>
      </div>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <EField label="Bedrooms"><EInput type="number" min="0" value={site.bedrooms} onChange={set("bedrooms")} /></EField>
        <EField label="Bathrooms"><EInput type="number" min="0" value={site.bathrooms} onChange={set("bathrooms")} /></EField>
        <EField label="Floors"><EInput type="number" min="1" value={site.floorCount} onChange={set("floorCount")} /></EField>
        <EField label="Area (sqm)"><EInput type="number" min="0" step="0.5" value={site.serviceAreaSqm} onChange={set("serviceAreaSqm")} /></EField>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        <input type="checkbox" checked={site.hasBalcony} onChange={(event) => onOneOff({ hasBalcony: event.target.checked })} />
        Site has a balcony or outside area
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="On-site contact name"><EInput value={site.siteContactName} onChange={set("siteContactName")} /></EField>
        <EField label="On-site contact phone"><EInput type="tel" inputMode="tel" maxLength={20} value={site.siteContactPhone} onChange={set("siteContactPhone")} /></EField>
      </div>
      <EField label="Scope of work"><ETextarea value={site.scopeOfWork} onChange={set("scopeOfWork")} /></EField>
      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Access instructions"><ETextarea value={site.accessInstructions} onChange={set("accessInstructions")} /></EField>
        <EField label="Parking and arrival"><ETextarea value={site.parkingInstructions} onChange={set("parkingInstructions")} /></EField>
        <EField label="Hazards and safety"><ETextarea value={site.hazardNotes} onChange={set("hazardNotes")} /></EField>
        <EField label="Equipment and utilities"><ETextarea value={site.equipmentNotes} onChange={set("equipmentNotes")} /></EField>
      </div>
      <EField label="Key pickup location"><EInput value={site.keyPickupLocation} onChange={set("keyPickupLocation")} /></EField>
    </div>
  );
}

export function PropertySection({ draft, options, facts, onChooseProperty, onSiteMode, onOneOff, problemFields, compact = false }: PropertySectionProps) {
  const [query, setQuery] = useState("");
  const list = options.data?.properties ?? [];
  const byId = useMemo(() => new Map(list.map((property) => [property.id, property])), [list]);
  const recent = (options.data?.recentPropertyIds ?? []).map((id) => byId.get(id)).filter((row): row is NewJobPropertyOption => Boolean(row));
  const visible = useMemo(() => {
    const pool = list.filter((property) => !property.isOneOff || property.id === draft.propertyId);
    const found = query.trim() ? pool.filter((property) => matches(property, query)) : pool.filter((property) => property.id === draft.propertyId);
    return found.slice(0, 8);
  }, [list, query, draft.propertyId]);
  const selected = draft.propertyId ? byId.get(draft.propertyId) ?? null : null;
  const isOneOff = draft.siteMode === "one_off";

  return (
    <div {...tourTarget("admin.jobs.create.property")} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Where"
          value={draft.siteMode}
          options={[{ value: "property", label: "Saved property" }, { value: "one_off", label: "One-off address" }]}
          onChange={onSiteMode}
        />
      </div>
      {isOneOff ? (
        <>
          {draft.jobType === "AIRBNB_TURNOVER" ? (
            <p role="note" className="text-[0.8125rem] text-[hsl(var(--e-band-attention-fg))]">An Airbnb turnover needs a saved property. Choose another job type for a one-off address.</p>
          ) : null}
          <OneOffFields draft={draft} onOneOff={onOneOff} problemFields={problemFields} />
          <Faint>One-off address keeps today&apos;s service-site path: name, address, rooms, contact, scope, access, parking, hazards, equipment and key pickup, and a site is created for the job.</Faint>
        </>
      ) : (
        <>
          <div className={cn("flex flex-col gap-2", !compact && "sm:flex-row sm:items-center")}>
            <label htmlFor="new-job-property-search" className="sr-only">Search properties</label>
            <EInput
              id="new-job-property-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, address or client"
              className="max-sm:text-[16px] sm:max-w-[22rem]"
              aria-invalid={problemFields.has("property") || undefined}
              aria-describedby={problemFields.has("property") ? "new-job-property-problem" : undefined}
            />
            {recent.length ? (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Recent properties">
                <Faint className={compact ? "w-full text-[0.6875rem] uppercase tracking-wide" : undefined}>Recent:</Faint>
                {recent.map((property) => (
                  <ChoiceChip key={property.id} selected={draft.propertyId === property.id} onClick={() => onChooseProperty(property.id)}>
                    {property.name}
                  </ChoiceChip>
                ))}
              </div>
            ) : null}
          </div>
          {problemFields.has("property") ? (
            <p id="new-job-property-problem" role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Choose a property.</p>
          ) : null}
          {options.status === "loading" && !options.data ? <Faint>Loading properties…</Faint> : null}
          {options.status === "error" && !options.data ? (
            <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
              Properties could not be loaded. <button type="button" className="underline" onClick={options.reload}>Try again</button>
            </p>
          ) : null}
          {visible.length > 0 ? (
            <div role="radiogroup" aria-label="Matching properties" className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              {visible.map((property) => {
                const on = property.id === draft.propertyId;
                return (
                  <button
                    key={property.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onChooseProperty(property.id)}
                    className={cn(
                      "flex min-h-[44px] w-full items-center gap-3 border-t border-[hsl(var(--e-border))] px-3 py-2 text-left first:border-t-0",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--e-ring))]",
                      on ? "bg-[hsl(var(--e-band-good-bg))]" : "hover:bg-[hsl(var(--e-muted))]",
                    )}
                  >
                    <span aria-hidden className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border", on ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "border-[hsl(var(--e-border-strong))]")}>
                      {on ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 text-[0.8125rem]">
                      <span className="font-[600] text-[hsl(var(--e-foreground))]">{property.name}</span>
                      <span className={cn("text-[hsl(var(--e-text-secondary))]", compact ? "block" : "max-sm:block")}>
                        <span className={compact ? "hidden" : "max-sm:hidden"}> · </span>
                        {property.address}{property.suburb ? `, ${property.suburb}` : ""}{property.clientName ? ` · ${property.clientName}` : ""}
                      </span>
                    </span>
                    {!property.isActive ? (
                      <span className="shrink-0 rounded-full bg-[hsl(var(--e-muted))] px-2 py-0.5 text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">Inactive</span>
                    ) : property.lastJobDayKey ? (
                      <span className={cn("shrink-0 text-[0.75rem] text-[hsl(var(--e-text-secondary))]", compact && "hidden")}>last job {dayLabel(property.lastJobDayKey)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : query.trim() && options.data ? (
            <Faint>No property matches &quot;{query.trim()}&quot;.</Faint>
          ) : null}
          {selected ? <SelectedPropertyCard facts={facts} compact={compact} propertyId={selected.id} inactive={!selected.isActive} /> : null}
        </>
      )}
    </div>
  );
}

function SelectedPropertyCard({ facts, compact, propertyId, inactive }: { facts: ReadState<NewJobPropertyFacts>; compact: boolean; propertyId: string; inactive: boolean }) {
  if (facts.status === "loading" && !facts.data) return <Faint>Reading the property…</Faint>;
  if (!facts.data) {
    return facts.status === "error" ? (
      <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
        {facts.error ?? "The property could not be read."} <button type="button" className="underline" onClick={facts.reload}>Try again</button>
      </p>
    ) : null;
  }
  const data = facts.data;
  if (compact) {
    return (
      <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        <span aria-hidden>i </span>
        {factsLine(data)}{data.preferredCleaner ? ` · preferred cleaner ${data.preferredCleaner.name}` : ""}
        {inactive ? " · this property is inactive" : ""}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))] p-3 sm:flex-row">
      {data.property.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.property.imageUrl} alt="" className="h-20 w-full rounded-[var(--e-radius-sm)] object-cover sm:w-32" />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.9375rem] font-[600] text-[hsl(var(--e-foreground))]">{data.property.name}</p>
          <Link href={`/v2/admin/properties/${encodeURIComponent(propertyId)}`} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline">Open property</Link>
        </div>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{factsLine(data)}</p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          Client {data.client?.name ?? "not set"} · Preferred cleaner {data.preferredCleaner ? `${data.preferredCleaner.name}${data.preferredCleaner.active ? "" : " (not an active cleaner)"}` : "none"}
        </p>
        {inactive ? <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-band-attention-fg))]">This property is inactive. The job can still be created; recurring rules skip inactive properties.</p> : null}
      </div>
    </div>
  );
}
