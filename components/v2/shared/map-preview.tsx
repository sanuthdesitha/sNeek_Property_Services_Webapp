"use client";

/**
 * A small map thumbnail for one pinned place, with the link as the fallback.
 *
 * The access guide only ever offered "Open in Maps". That answers the question
 * by sending the cleaner out of the app — they leave, orient themselves, come
 * back, and hope they remembered which corner. A thumbnail answers it in place.
 *
 * The image is served by /api/maps/static, which holds the API key server-side.
 * When no key is configured that route 404s, this falls back to the plain link,
 * and the guide behaves exactly as it did before — the preview is an upgrade
 * where maps are set up, never a dependency.
 */

import * as React from "react";
import { ExternalLink, MapPin } from "lucide-react";

export function MapPreview({
  lat,
  lng,
  label,
  className,
}: {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  // Small on purpose. This sits inside a step in a list on a phone; a large map
  // pushes the instructions that matter below the fold, which is the complaint
  // that prompted it.
  const src = `/api/maps/static?lat=${lat}&lng=${lng}&w=320&h=140&zoom=17`;

  if (failed) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[0.8125rem] text-[hsl(var(--e-primary))] underline underline-offset-2"
      >
        <MapPin className="h-3.5 w-3.5" />
        Open in Maps
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={
        "group relative block overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] " +
        (className ?? "h-[70px] w-full max-w-[220px]")
      }
      aria-label={label ? `Open ${label} in Maps` : "Open in Maps"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label ? `Map showing ${label}` : "Map"}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
      <span className="absolute right-1 top-1 rounded-full bg-[hsl(160_18%_8%/0.6)] p-1 text-white">
        <ExternalLink className="h-3 w-3" />
      </span>
    </a>
  );
}
