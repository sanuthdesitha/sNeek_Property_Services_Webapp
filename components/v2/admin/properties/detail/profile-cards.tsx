"use client";

/**
 * Overview's "Details" and "Cleaning standard and pay" cards: the old Profile
 * form split into sections with their own Edit. Each sends only its own keys
 * (same PATCH, same field rules as before).
 */
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import { EPill } from "@/components/v2/ui/pill";
import { formatCurrency } from "@/lib/utils";
import { PropertyCoverImage } from "../property-cover-image";
import { KeyValues, Muted, SectionCard } from "./section-card";
import { optionalNumber, type PropertyRecord } from "./property-record";
import type { SaveResult } from "./use-property-record";

type Save = (patch: Record<string, unknown>) => Promise<SaveResult>;

type DetailsDraft = {
  name: string; address: string; suburb: string; state: string; postcode: string;
  latitude: number | null; longitude: number | null; placeId: string | null;
  bedrooms: string; bathrooms: string; sofaBedCount: string; checkin: string; checkout: string; imageUrl: string;
};

function roomsText(property: PropertyRecord): string {
  return [
    `${property.bedrooms} bed`,
    `${property.bathrooms} bath`,
    property.sofaBedCount > 0 ? `${property.sofaBedCount} sofa bed` : null,
    property.hasBalcony ? "balcony" : null,
  ].filter(Boolean).join(" · ");
}

export function DetailsCard({ property, save }: { property: PropertyRecord; save: Save }) {
  const hasPin = property.latitude !== null && property.latitude !== undefined && property.longitude !== null && property.longitude !== undefined;
  return (
    <SectionCard<DetailsDraft>
      title="Details"
      className="flex-1"
      view={
        <div className="flex flex-wrap items-start gap-3">
          {property.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={property.imageUrl} alt="Cover photo" className="h-[72px] w-[96px] rounded-[6px] border border-[hsl(var(--e-border))] object-cover" />
          ) : (
            <span aria-label="No cover photo" className="h-[72px] w-[96px] rounded-[6px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]" />
          )}
          <div className="min-w-0 flex-1">
            <KeyValues
              rows={[
                ["Name", property.name],
                ["Address", <>{[property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(", ")} {hasPin ? <EPill tone="ok">Map pin set</EPill> : <EPill tone="warn">No map pin</EPill>}</>],
                ["Rooms", roomsText(property)],
                ["Times", `Check-in ${property.defaultCheckinTime ?? "not set"} · checkout ${property.defaultCheckoutTime ?? "not set"}`],
              ]}
            />
          </div>
        </div>
      }
      initialDraft={() => ({
        name: property.name ?? "", address: property.address ?? "", suburb: property.suburb ?? "", state: property.state ?? "NSW", postcode: property.postcode ?? "",
        latitude: property.latitude ?? null, longitude: property.longitude ?? null, placeId: property.placeId ?? null,
        bedrooms: String(property.bedrooms ?? 1), bathrooms: String(property.bathrooms ?? 1), sofaBedCount: String(property.sofaBedCount ?? 0),
        checkin: property.defaultCheckinTime ?? "14:00", checkout: property.defaultCheckoutTime ?? "10:00", imageUrl: property.imageUrl ?? "",
      })}
      form={(draft, setDraft) => (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <EField label="Property name"><EInput value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} /></EField>
            <EField label="Suburb"><EInput value={draft.suburb} onChange={(e) => setDraft({ suburb: e.target.value })} /></EField>
          </div>
          <EField label="Address">
            <EAddressInput
              value={draft.address}
              placeholder="Start typing an address…"
              onChange={(text) => setDraft({ address: text })}
              onSelect={(r) => setDraft({ address: r.formattedAddress, suburb: r.suburb ?? draft.suburb, state: r.state ?? draft.state, postcode: r.postcode ?? draft.postcode, latitude: r.lat, longitude: r.lng, placeId: r.placeId })}
            />
          </EField>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <EField label="State"><EInput maxLength={3} value={draft.state} onChange={(e) => setDraft({ state: e.target.value.toUpperCase() })} /></EField>
            <EField label="Postcode"><EInput inputMode="numeric" maxLength={4} value={draft.postcode} onChange={(e) => setDraft({ postcode: e.target.value })} /></EField>
            <EField label="Sofa beds"><EInput type="number" min="0" value={draft.sofaBedCount} onChange={(e) => setDraft({ sofaBedCount: e.target.value })} /></EField>
            <EField label="Bedrooms"><EInput type="number" min="0" value={draft.bedrooms} onChange={(e) => setDraft({ bedrooms: e.target.value })} /></EField>
            <EField label="Bathrooms"><EInput type="number" min="0" value={draft.bathrooms} onChange={(e) => setDraft({ bathrooms: e.target.value })} /></EField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Check-in time"><EInput type="time" value={draft.checkin} onChange={(e) => setDraft({ checkin: e.target.value })} /></EField>
            <EField label="Checkout time"><EInput type="time" value={draft.checkout} onChange={(e) => setDraft({ checkout: e.target.value })} /></EField>
          </div>
          <EField label="Cover photo"><PropertyCoverImage value={draft.imageUrl} onChange={(url) => setDraft({ imageUrl: url })} /></EField>
        </>
      )}
      onSave={(draft) =>
        save({
          name: draft.name,
          address: draft.address,
          suburb: draft.suburb,
          state: draft.state || "NSW",
          postcode: draft.postcode || undefined,
          latitude: draft.latitude ?? undefined,
          longitude: draft.longitude ?? undefined,
          placeId: draft.placeId ?? undefined,
          imageUrl: draft.imageUrl.trim() || null,
          bedrooms: Number(draft.bedrooms || 0),
          bathrooms: Number(draft.bathrooms || 0),
          sofaBedCount: Number(draft.sofaBedCount || 0),
          defaultCheckinTime: draft.checkin,
          defaultCheckoutTime: draft.checkout,
        })
      }
    />
  );
}

type StandardDraft = { assignedCleaningHours: string; cleaningDurationMinutes: string; cleanerServiceRate: string; linenBufferSets: string };

const asText = (value: number | null | undefined) => (typeof value === "number" ? String(value) : "");

export function CleaningStandardCard({ property, save }: { property: PropertyRecord; save: Save }) {
  return (
    <SectionCard<StandardDraft>
      title="Cleaning standard and pay"
      className="flex-1"
      view={
        <KeyValues
          rows={[
            ["Assigned hours", typeof property.assignedCleaningHours === "number" ? <>{property.assignedCleaningHours} h <Muted>prefills new jobs</Muted></> : <Muted>Not set</Muted>],
            ["QA baseline", typeof property.cleaningDurationMinutes === "number" ? `${property.cleaningDurationMinutes} min` : <Muted>Not set</Muted>],
            ["Cleaner rate", typeof property.cleanerServiceRate === "number" ? <>{formatCurrency(property.cleanerServiceRate)} per clean <Muted>overrides hourly</Muted></> : <Muted>Not set (hourly)</Muted>],
            ["Linen buffer", `${property.linenBufferSets ?? 0} sets`],
          ]}
        />
      }
      initialDraft={() => ({
        assignedCleaningHours: asText(property.assignedCleaningHours),
        cleaningDurationMinutes: asText(property.cleaningDurationMinutes),
        cleanerServiceRate: asText(property.cleanerServiceRate),
        linenBufferSets: String(property.linenBufferSets ?? 0),
      })}
      form={(draft, setDraft) => (
        <div className="grid gap-3 md:grid-cols-2">
          <EField label="Assigned cleaning hours" hint="Decimal hours (e.g. 2.75) — new jobs prefill their estimated hours from this">
            <EInput type="number" min="0" step="0.25" placeholder="e.g. 2.75" value={draft.assignedCleaningHours} onChange={(e) => setDraft({ assignedCleaningHours: e.target.value })} />
          </EField>
          <EField label="Clean duration (min)" hint="QA duration baseline (minutes) — optional">
            <EInput type="number" min="0" placeholder="e.g. 120" value={draft.cleaningDurationMinutes} onChange={(e) => setDraft({ cleaningDurationMinutes: e.target.value })} />
          </EField>
          <EField label="Cleaner service rate ($)" hint="Per-clean cleaner rate — overrides hourly maths">
            <EInput type="number" min="0" step="0.01" value={draft.cleanerServiceRate} onChange={(e) => setDraft({ cleanerServiceRate: e.target.value })} />
          </EField>
          <EField label="Linen buffer sets">
            <EInput type="number" min="0" value={draft.linenBufferSets} onChange={(e) => setDraft({ linenBufferSets: e.target.value })} />
          </EField>
        </div>
      )}
      onSave={(draft) =>
        save({
          assignedCleaningHours: optionalNumber(draft.assignedCleaningHours),
          cleaningDurationMinutes: optionalNumber(draft.cleaningDurationMinutes),
          cleanerServiceRate: optionalNumber(draft.cleanerServiceRate),
          linenBufferSets: Number(draft.linenBufferSets || 0),
        })
      }
    />
  );
}
