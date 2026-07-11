"use client";

/**
 * v1 cleaner-facing PROPERTY ACCESS GUIDE.
 *
 * Surfaces the same rich `Property.accessGuide` the v2 UI shows, but in the v1
 * cleaner styling. Self-fetches from the cleaner-scoped endpoint
 *   GET /api/cleaner/property-access/:propertyId
 * (authorized only for a cleaner assigned to a job at that property). Renders
 * nothing when there is no guide. Reuses the v1 MediaGallery (thumbnails open a
 * larger lightbox with prev/next).
 */
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";

type GuideImage = { url: string; caption?: string };
type GuideEntry = {
  id: string;
  kind: string;
  label: string;
  instructions?: string;
  images: GuideImage[];
};

const KIND_LABELS: Record<string, string> = {
  LOCKBOX: "Lockbox",
  KEYS: "Keys",
  ENTRY: "Entry",
  ALARM: "Alarm",
  PARKING: "Parking",
  BIN_ROOM: "Bin room",
  SUPPLIES_CUPBOARD: "Supplies cupboard",
  WIFI: "Wi-Fi",
  OTHER: "Other",
};

export function PropertyAccessGuide({ propertyId }: { propertyId: string | undefined }) {
  const [entries, setEntries] = useState<GuideEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!propertyId) return;
    fetch(`/api/cleaner/property-access/${propertyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data?.accessGuide) ? (data.accessGuide as GuideEntry[]) : []);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-950">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-sky-800" />
        <p className="font-semibold uppercase tracking-[0.14em] text-sky-800">Property Access Guide</p>
      </div>
      <div className="space-y-2.5">
        {entries.map((entry) => {
          const items: MediaGalleryItem[] = (entry.images ?? []).map((img, i) => ({
            id: `${entry.id}-${i}`,
            url: img.url,
            label: img.caption || entry.label,
            mediaType: "PHOTO",
          }));
          return (
            <div key={entry.id} className="rounded-lg border border-sky-200/80 bg-white/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-800">
                {KIND_LABELS[entry.kind] ?? "Access"}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-sky-950">{entry.label}</p>
              {entry.instructions ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-sky-950">{entry.instructions}</p>
              ) : null}
              {items.length > 0 ? (
                <MediaGallery
                  items={items}
                  title={entry.label}
                  className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
