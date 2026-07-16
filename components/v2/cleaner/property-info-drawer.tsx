"use client";

/**
 * ESTATE cleaner — Property info drawer. A full-height sheet gathering
 * everything a cleaner might need mid-job: address (with copy), access
 * instructions, laundry-bag identity, setup reference gallery, the "read first"
 * context, restock needs, and contact numbers. Pure props — no data fetching.
 */
import * as React from "react";
import { Check, Copy, KeyRound, MapPin, Shirt, Package, X } from "lucide-react";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";
import { EAccessInfo } from "@/components/v2/shared/access-info";
import PropertyAccessGuide from "@/components/v2/cleaner/property-access-guide";
import { ReadFirstBlock, type ReadFirstItem } from "./read-first-block";
import { ContactRows, type JobContact } from "./contact-sheet";

type SetupGuideEntry = {
  id?: string;
  label?: string;
  instructions?: string;
  images?: Array<{ url?: string; caption?: string }>;
};

function SectionHeading({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">
      {icon}
      {children}
    </p>
  );
}

function AddressBlock({ property }: { property: any }) {
  const [copied, setCopied] = React.useState(false);
  const parts = [
    property?.address,
    property?.suburb,
    [property?.state, property?.postcode].filter(Boolean).join(" "),
  ]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  const full = parts.join(", ");
  if (!full) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  }

  return (
    <div className="space-y-2">
      <SectionHeading>Address</SectionHeading>
      <div className="flex items-start justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3">
        <p className="font-mono text-[0.8125rem] leading-relaxed text-[hsl(var(--e-foreground))]">{full}</p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-2 py-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))] transition-colors hover:bg-[hsl(var(--e-muted))]"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--e-success))]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function LaundryBagBlock({ property }: { property: any }) {
  const label = typeof property?.laundryBagLabel === "string" ? property.laundryBagLabel.trim() : "";
  const color = typeof property?.laundryBagColor === "string" ? property.laundryBagColor.trim() : "";
  if (!label && !color) return null;
  return (
    <div className="space-y-2">
      <SectionHeading icon={<Shirt className="h-3.5 w-3.5" />}>Laundry bag</SectionHeading>
      <div className="flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
        {color ? (
          <span
            className="h-6 w-6 shrink-0 rounded-full border border-[hsl(var(--e-border-strong))]"
            style={{ backgroundColor: color }}
            aria-hidden
          />
        ) : null}
        <span className="text-[0.875rem] text-[hsl(var(--e-foreground))]">
          {label || "Bag"}
          {color ? <span className="ml-1 text-[hsl(var(--e-muted-foreground))]">({color})</span> : null}
        </span>
      </div>
    </div>
  );
}

function SetupGuideBlock({ property }: { property: any }) {
  const entries: SetupGuideEntry[] = Array.isArray(property?.setupGuide) ? property.setupGuide : [];
  const withContent = entries.filter(
    (e) =>
      (Array.isArray(e.images) && e.images.some((im) => im?.url)) ||
      (typeof e.instructions === "string" && e.instructions.trim())
  );
  if (withContent.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionHeading>Setup reference</SectionHeading>
      {withContent.map((entry, ei) => {
        const images = Array.isArray(entry.images) ? entry.images.filter((im) => im?.url) : [];
        const galleryItems: MediaGalleryItem[] = images.map((im, ii) => ({
          id: `${entry.id || ei}-${ii}`,
          url: im.url as string,
          label: im.caption || entry.label || undefined,
        }));
        return (
          <div key={entry.id || `setup-${ei}`} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            {entry.label ? <p className="text-[0.8125rem] font-[550]">{entry.label}</p> : null}
            {entry.instructions ? (
              <p className="mt-0.5 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {entry.instructions}
              </p>
            ) : null}
            {galleryItems.length > 0 ? (
              <MediaGallery
                items={galleryItems}
                title={entry.label || "Setup reference"}
                className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RestockBlock({
  restockNeeds,
}: {
  restockNeeds: { name: string; needed: number; unit?: string | null }[];
}) {
  if (!restockNeeds || restockNeeds.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionHeading icon={<Package className="h-3.5 w-3.5" />}>Restock needs</SectionHeading>
      <ul className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        {restockNeeds.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate text-[0.8125rem] text-[hsl(var(--e-foreground))]">{item.name}</span>
            <span className="shrink-0 text-[0.8125rem] font-[600] tabular-nums text-[hsl(var(--e-text-secondary))]">
              {item.needed}
              {item.unit ? ` ${item.unit}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PropertyInfoDrawer({
  open,
  onClose,
  property,
  propertyId,
  keyPickupLocation,
  contact,
  readFirstItems,
  restockNeeds,
}: {
  open: boolean;
  onClose: () => void;
  property: any;
  /** Drives the canonical access guide render (the single access surface). */
  propertyId?: string | null;
  /** Where the cleaner collects keys (jobMeta.serviceContext.keyPickupLocation). */
  keyPickupLocation?: string | null;
  contact: JobContact | null;
  readFirstItems: ReadFirstItem[];
  restockNeeds: { name: string; needed: number; unit?: string | null }[];
}) {
  // Text from the canonical access guide, so the flat accessInfo fallback below
  // never repeats a datum the guide already shows.
  const [guideTexts, setGuideTexts] = React.useState<string[]>([]);
  const handleGuideEntries = React.useCallback((entries: any[]) => {
    const texts: string[] = [];
    for (const e of entries ?? []) {
      if (typeof e?.label === "string" && e.label.trim()) texts.push(e.label);
      if (typeof e?.instructions === "string" && e.instructions.trim()) texts.push(e.instructions);
      for (const img of Array.isArray(e?.images) ? e.images : []) {
        if (typeof img?.caption === "string" && img.caption.trim()) texts.push(img.caption);
      }
    }
    setGuideTexts(texts);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const keyPickup = typeof keyPickupLocation === "string" ? keyPickupLocation.trim() : "";
  const title =
    (typeof property?.name === "string" && property.name.trim()) ||
    (typeof property?.suburb === "string" && property.suburb.trim()) ||
    "Property";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]" onClick={onClose} />
      <div className="e-rise relative z-10 flex h-full w-full max-w-md flex-col border-l border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]">
        <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--e-border))] px-5 py-3.5">
          <h2 className="min-w-0 truncate text-[0.9375rem] font-[600]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <AddressBlock property={property} />

          {keyPickup ? (
            <div className="space-y-2">
              <SectionHeading icon={<MapPin className="h-3.5 w-3.5" />}>Key pickup</SectionHeading>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-foreground))]">{keyPickup}</p>
              </div>
            </div>
          ) : null}

          {propertyId || property?.accessInfo ? (
            <div className="space-y-2">
              <SectionHeading icon={<KeyRound className="h-3.5 w-3.5" />}>Access</SectionHeading>
              {/* Canonical access surface — the SAME guide used across the portal. */}
              {propertyId ? (
                <PropertyAccessGuide propertyId={propertyId} embedded onEntriesLoaded={handleGuideEntries} />
              ) : null}
              {/* Flat accessInfo fallback, deduped against the guide above. */}
              {property?.accessInfo ? (
                <EAccessInfo
                  accessInfo={property.accessInfo}
                  title="Access instructions"
                  defaultOpen
                  excludeTexts={guideTexts}
                />
              ) : null}
            </div>
          ) : null}

          <LaundryBagBlock property={property} />
          <SetupGuideBlock property={property} />

          {readFirstItems && readFirstItems.length > 0 ? (
            <ReadFirstBlock items={readFirstItems} defaultVisible={readFirstItems.length} />
          ) : null}

          <RestockBlock restockNeeds={restockNeeds} />

          {contact ? (
            <div className="space-y-2">
              <SectionHeading>Contact</SectionHeading>
              <ContactRows contact={contact} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
