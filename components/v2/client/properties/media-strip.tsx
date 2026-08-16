"use client";

/**
 * Estate media strip — thumbnail grid that opens each asset in an IN-PORTAL
 * lightbox with prev/next, the same viewer the staff surfaces use.
 *
 * It used to render `<a target="_blank">` per thumbnail, which threw the client
 * out of the portal into a bare S3 URL: no label, no next image, no way back
 * except the browser's back button. That was the documented intent of the
 * original component ("opens each asset in a new tab") and it was simply the
 * wrong call — admin has had a real lightbox all along.
 *
 * It is now a client component. It was previously "server-safe (no client
 * hooks)"; the callers are server pages, which may render a client component
 * freely, and every prop here is serialisable.
 *
 * The grid classes are kept as they were so the property pages that size this
 * strip are unaffected.
 */

import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";

export type EMediaItem = {
  id: string;
  url: string;
  label?: string | null;
  mediaType?: string | null;
};

export function EMediaStrip({
  items,
  className,
  emptyText,
}: {
  items: EMediaItem[];
  className?: string;
  emptyText?: string;
}) {
  const galleryItems: MediaGalleryItem[] = items.map((item) => ({
    id: item.id,
    url: item.url,
    label: item.label ?? undefined,
    mediaType: item.mediaType ?? undefined,
  }));

  return (
    <MediaGallery
      items={galleryItems}
      emptyText={emptyText ?? ""}
      className={className ?? "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"}
    />
  );
}
