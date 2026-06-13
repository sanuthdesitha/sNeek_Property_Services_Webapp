"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Play } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FormFieldReference } from "@/lib/forms/types";

export interface FieldReferencesProps {
  references: FormFieldReference[] | undefined;
  className?: string;
  /**
   * "thumbs" (default): show the reference thumbnails inline as before.
   * "affordance": show a single compact "See example" button that opens the
   * lightbox — used next to checklist items so the reference doesn't crowd the
   * row until the cleaner asks for it.
   */
  variant?: "thumbs" | "affordance";
}

// Shows the admin-attached reference/example media to the person filling the
// form (cleaner / QA). Images open in a swipeable lightbox; videos and links
// open in a new tab. Assumes `url` is already resolved (the job-form API
// resolves any uploaded storageKey to a presigned URL before sending the
// template).
export function FieldReferences({ references, className, variant = "thumbs" }: FieldReferencesProps) {
  const items = React.useMemo(() => (references ?? []).filter((ref) => ref.url), [references]);
  const images = React.useMemo(() => items.filter((ref) => ref.kind === "image"), [items]);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

  if (items.length === 0) return null;

  const openImageAt = (ref: FormFieldReference) => {
    const idx = images.findIndex((img) => img.url === ref.url);
    setLightboxIndex(idx === -1 ? 0 : idx);
  };

  const lightbox =
    images.length > 0 ? (
      <ReferenceLightbox
        images={images}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
      />
    ) : null;

  // Compact affordance: a single "See example" button + non-image links.
  if (variant === "affordance") {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2">
          {images.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11"
              onClick={() => setLightboxIndex(0)}
            >
              <ImageIcon className="mr-1.5 size-4" />
              See example{images.length > 1 ? ` (${images.length})` : ""}
            </Button>
          ) : null}
          {items
            .filter((ref) => ref.kind !== "image")
            .map((ref, idx) => (
              <NonImageReference key={`${ref.url}-${idx}`} reference={ref} />
            ))}
        </div>
        {lightbox}
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Reference
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((ref, idx) => {
          if (ref.kind === "image") {
            return (
              <button
                key={`${ref.url}-${idx}`}
                type="button"
                onClick={() => openImageAt(ref)}
                className="group relative size-16 overflow-hidden rounded-md border"
                title={ref.caption ?? "Reference image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.url} alt={ref.caption ?? "Reference"} className="size-16 object-cover" />
              </button>
            );
          }
          return <NonImageReference key={`${ref.url}-${idx}`} reference={ref} />;
        })}
      </div>
      {lightbox}
    </div>
  );
}

/**
 * "Example image on tick": shows a compact "See example" affordance and — when
 * the field becomes positively answered (checkbox ticked, yes/no = Yes, photo
 * captured, any answer entered) — pops the example image lightbox open once so
 * the cleaner sees the reference exactly when they act on the item. Re-arms
 * when the answer is cleared, so it can fire again on re-tick.
 *
 * Rendered by the shared field renderer, so it works in the cleaner job flow
 * AND the guided-capture flow with no per-page wiring.
 */
export function ExampleOnTickReferences({
  references,
  value,
  enabled = true,
  className,
}: {
  references: FormFieldReference[] | undefined;
  value: unknown;
  enabled?: boolean;
  className?: string;
}) {
  const items = React.useMemo(() => (references ?? []).filter((ref) => ref.url), [references]);
  const images = React.useMemo(() => items.filter((ref) => ref.kind === "image"), [items]);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const wasPositive = React.useRef(false);

  const positive = isPositiveAnswer(value);

  React.useEffect(() => {
    if (!enabled || images.length === 0) return;
    if (positive && !wasPositive.current) {
      setLightboxIndex(0);
    }
    wasPositive.current = positive;
  }, [positive, enabled, images.length]);

  if (items.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {images.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11"
            onClick={() => setLightboxIndex(0)}
          >
            <ImageIcon className="mr-1.5 size-4" />
            See example{images.length > 1 ? ` (${images.length})` : ""}
          </Button>
        ) : null}
        {items
          .filter((ref) => ref.kind !== "image")
          .map((ref, idx) => (
            <NonImageReference key={`${ref.url}-${idx}`} reference={ref} />
          ))}
      </div>
      {images.length > 0 ? (
        <ReferenceLightbox images={images} index={lightboxIndex} onIndexChange={setLightboxIndex} />
      ) : null}
    </div>
  );
}

// A field counts as "positively answered" — for the purpose of popping the
// example — when it carries a meaningful, non-negative value.
function isPositiveAnswer(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "" || v === "no" || v === "false" || v === "na" || v === "n/a") return false;
    return true;
  }
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return true; // location / signature objects
  return Boolean(value);
}

function NonImageReference({ reference }: { reference: FormFieldReference }) {
  if (reference.kind === "video") {
    return (
      <a
        href={reference.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 items-center gap-1 rounded-md border bg-muted/40 px-2 py-1.5 text-xs hover:bg-muted"
      >
        <Play className="size-3.5" />
        {reference.caption?.trim() || "Watch example"}
      </a>
    );
  }
  return (
    <a
      href={reference.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center gap-1 rounded-md border bg-muted/40 px-2 py-1.5 text-xs hover:bg-muted"
    >
      <ExternalLink className="size-3.5" />
      {reference.caption?.trim() || "Open link"}
    </a>
  );
}

/**
 * Swipeable / arrow-navigable lightbox for one or more reference images.
 * Controlled via `index` (null = closed). Mobile-friendly: large tap targets,
 * touch-swipe between images, caption strip.
 */
function ReferenceLightbox({
  images,
  index,
  onIndexChange,
}: {
  images: FormFieldReference[];
  index: number | null;
  onIndexChange: (next: number | null) => void;
}) {
  const touchStartX = React.useRef<number | null>(null);
  const open = index !== null;
  const safeIndex = index ?? 0;
  const current = images[safeIndex];
  const multiple = images.length > 1;

  const go = React.useCallback(
    (delta: number) => {
      onIndexChange(((safeIndex + delta) % images.length + images.length) % images.length);
    },
    [safeIndex, images.length, onIndexChange]
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent className="max-w-3xl">
        {current ? (
          <div
            className="space-y-3"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              if (touchStartX.current === null || !multiple) return;
              const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
              if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
              touchStartX.current = null;
            }}
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={current.caption ?? "Reference"}
                className="max-h-[70vh] w-full rounded object-contain"
              />
              {multiple ? (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full"
                    onClick={() => go(-1)}
                    aria-label="Previous example"
                  >
                    <ChevronLeft className="size-5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full"
                    onClick={() => go(1)}
                    aria-label="Next example"
                  >
                    <ChevronRight className="size-5" />
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {current.caption?.trim() || "Reference example"}
              </p>
              {multiple ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {safeIndex + 1} / {images.length}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
