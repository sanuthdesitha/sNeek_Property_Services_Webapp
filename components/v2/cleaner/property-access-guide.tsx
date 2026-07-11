"use client";

/**
 * ESTATE — Cleaner-facing PROPERTY ACCESS GUIDE (v2).
 *
 * Self-fetches the property's access guide from the cleaner-scoped endpoint
 *   GET /api/cleaner/property-access/:propertyId
 * (authorized only for a cleaner assigned to a job at that property). Renders
 * NOTHING when there is no guide.
 *
 * CONTRACT — imported + mounted by the job workspace. Keep EXACTLY:
 *   export default function PropertyAccessGuide({ propertyId }: { propertyId: string })
 *
 * Estate token scope only — no components/ui/* or v1 imports.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmSmoke,
  Boxes,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  ImageIcon,
  Info,
  KeyRound,
  Lock,
  Trash,
  Wifi,
  X,
} from "lucide-react";

type GuideImage = { url: string; caption?: string };
type GuideEntry = {
  id: string;
  kind: string;
  label: string;
  instructions?: string;
  images: GuideImage[];
};

const KIND_META: Record<string, { label: string; icon: React.ReactNode }> = {
  LOCKBOX: { label: "Lockbox", icon: <Lock className="h-4 w-4" /> },
  KEYS: { label: "Keys", icon: <KeyRound className="h-4 w-4" /> },
  ENTRY: { label: "Entry", icon: <DoorOpen className="h-4 w-4" /> },
  ALARM: { label: "Alarm", icon: <AlarmSmoke className="h-4 w-4" /> },
  PARKING: { label: "Parking", icon: <Car className="h-4 w-4" /> },
  BIN_ROOM: { label: "Bin room", icon: <Trash className="h-4 w-4" /> },
  SUPPLIES_CUPBOARD: { label: "Supplies", icon: <Boxes className="h-4 w-4" /> },
  WIFI: { label: "Wi-Fi", icon: <Wifi className="h-4 w-4" /> },
  OTHER: { label: "Other", icon: <Info className="h-4 w-4" /> },
};

function metaFor(kind: string) {
  return KIND_META[kind] ?? KIND_META.OTHER;
}

export default function PropertyAccessGuide({ propertyId }: { propertyId: string }) {
  const [entries, setEntries] = useState<GuideEntry[] | null>(null);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<{ images: GuideImage[]; index: number; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!propertyId) return;
    fetch(`/api/cleaner/property-access/${propertyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.accessGuide) ? (data.accessGuide as GuideEntry[]) : [];
        setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const totalImages = useMemo(
    () => (entries ?? []).reduce((sum, e) => sum + (e.images?.length ?? 0), 0),
    [entries]
  );

  // Render nothing until loaded, and nothing when there is no guide.
  if (!entries || entries.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-[var(--e-radius-lg,0.875rem)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-1)]">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-gold),var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
          <KeyRound className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--e-gold-ink))]">
            Property access
          </span>
          <span className="block text-[0.9375rem] font-[560] text-[hsl(var(--e-foreground))]">
            {entries.length} access point{entries.length === 1 ? "" : "s"}
            {totalImages > 0 ? ` · ${totalImages} photo${totalImages === 1 ? "" : "s"}` : ""}
          </span>
        </span>
        <ChevronDown
          className={
            "h-5 w-5 shrink-0 text-[hsl(var(--e-muted-foreground))] transition-transform duration-200 " +
            (open ? "rotate-180" : "")
          }
        />
      </button>

      {open ? (
        <div className="space-y-2.5 border-t border-[hsl(var(--e-border))] p-3">
          {entries.map((entry) => {
            const meta = metaFor(entry.kind);
            const isOpen = !!expanded[entry.id];
            const imgCount = entry.images?.length ?? 0;
            return (
              <div
                key={entry.id}
                className="overflow-hidden rounded-[var(--e-radius,0.625rem)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]"
              >
                <button
                  type="button"
                  onClick={() => setExpanded((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--e-muted)/0.5)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-accent-portal,var(--e-gold-ink)))]">
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
                      {meta.label}
                    </span>
                    <span className="block truncate text-[0.9375rem] font-[550] text-[hsl(var(--e-foreground))]">
                      {entry.label}
                    </span>
                  </span>
                  {imgCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--e-radius-pill,999px)] bg-[hsl(var(--e-muted))] px-2 py-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                      <ImageIcon className="h-3 w-3" />
                      {imgCount}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={
                      "h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))] transition-transform duration-200 " +
                      (isOpen ? "rotate-180" : "")
                    }
                  />
                </button>

                {isOpen ? (
                  <div className="space-y-3 border-t border-[hsl(var(--e-border))] px-3 py-3">
                    {entry.instructions ? (
                      <p className="whitespace-pre-wrap text-[0.875rem] leading-6 text-[hsl(var(--e-text-secondary))]">
                        {entry.instructions}
                      </p>
                    ) : null}
                    {imgCount > 0 ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {entry.images.map((img, i) => (
                          <button
                            key={img.url + i}
                            type="button"
                            onClick={() => setLightbox({ images: entry.images, index: i, label: entry.label })}
                            className="group relative overflow-hidden rounded-[var(--e-radius,0.5rem)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
                            aria-label={img.caption || `View photo ${i + 1}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={img.caption || entry.label}
                              className="h-20 w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                            />
                            {img.caption ? (
                              <span className="absolute inset-x-0 bottom-0 truncate bg-[hsl(160_18%_8%/0.55)] px-1.5 py-0.5 text-[0.625rem] text-white">
                                {img.caption}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {lightbox ? (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          label={lightbox.label}
          onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}

function Lightbox({
  images,
  index,
  label,
  onIndex,
  onClose,
}: {
  images: GuideImage[];
  index: number;
  label: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const count = images.length;
  const safeIndex = Math.min(index, count - 1);
  const current = images[safeIndex];

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndex((safeIndex + delta + count) % count);
    },
    [count, safeIndex, onIndex]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[hsl(160_18%_5%/0.85)] p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex w-full max-w-3xl items-center justify-between gap-2 pb-2 text-white/90">
        <span className="truncate text-[0.875rem] font-[550]">{current?.caption || label}</span>
        <div className="flex items-center gap-2">
          {count > 1 ? (
            <span className="text-[0.75rem] tabular-nums text-white/70">
              {safeIndex + 1} / {count}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative flex w-full max-w-3xl items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current?.url}
          alt={current?.caption || label}
          className="max-h-[74vh] w-auto max-w-full select-none rounded-[var(--e-radius,0.5rem)] object-contain"
          draggable={false}
        />
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1" onClick={(e) => e.stopPropagation()}>
          {images.map((img, i) => (
            <button
              key={img.url + i}
              type="button"
              onClick={() => onIndex(i)}
              aria-label={`Photo ${i + 1}`}
              className={
                "shrink-0 overflow-hidden rounded-md border-2 " +
                (i === safeIndex ? "border-[hsl(var(--e-gold))]" : "border-transparent opacity-60")
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-12 w-12 object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
