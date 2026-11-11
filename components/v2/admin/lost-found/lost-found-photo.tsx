"use client";

/**
 * A lost and found photo. Shows the stored link; if that cannot be read (a
 * private bucket), asks the existing signed-access route for a short-lived
 * link once. A photo that still cannot be shown says so instead of a broken
 * image. The lightbox is the old board's: click to enlarge, Escape or click
 * to close.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LostFoundPhoto } from "@/lib/lost-found/service";

type Source = { url: string; signed: boolean } | { url: null; signed: true };

export function useLostFoundPhotoSource(photo: LostFoundPhoto) {
  const [source, setSource] = React.useState<Source>({ url: photo.url, signed: false });
  React.useEffect(() => setSource({ url: photo.url, signed: false }), [photo.url]);

  const onError = React.useCallback(() => {
    if (source.signed) {
      setSource({ url: null, signed: true });
      return;
    }
    const controller = new AbortController();
    fetch(`/api/uploads/access?key=${encodeURIComponent(photo.key)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { url?: string } | null;
        if (controller.signal.aborted) return;
        setSource(response.ok && body?.url ? { url: body.url, signed: true } : { url: null, signed: true });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource({ url: null, signed: true });
      });
  }, [photo.key, source.signed]);

  return { url: source.url, onError };
}

export function LostFoundThumb({ photo, alt, className, onOpen }: { photo: LostFoundPhoto; alt: string; className?: string; onOpen?: (url: string) => void }) {
  const { url, onError } = useLostFoundPhotoSource(photo);
  const box = cn("flex-none overflow-hidden rounded-[8px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]", className);
  if (!url) {
    return (
      <span className={cn(box, "flex items-center justify-center text-center text-[0.625rem] text-[hsl(var(--e-muted-foreground))]")}>
        Photo unavailable
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={url} alt={alt} onError={onError} className="h-full w-full object-cover" />;
  if (!onOpen) return <span className={box}>{image}</span>;
  return (
    <button type="button" className={cn(box, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]")} onClick={() => onOpen(url)} aria-label={`Enlarge photo of ${alt}`}>
      {image}
    </button>
  );
}

export function LostFoundLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!url) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [url, onClose]);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[hsl(160_18%_8%/0.8)] p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Photo">
      <button ref={closeRef} type="button" aria-label="Close photo" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 text-white" onClick={onClose}>
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] rounded-[var(--e-radius)] object-contain" />
    </div>
  );
}
