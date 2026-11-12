"use client";

/**
 * A lost and found photo. Shown through the item's photo route (`photo.src`,
 * lib/lost-found/photo-src.ts), which re-checks access and redirects to a
 * fresh signed link, so private and public buckets both work. A photo that
 * cannot be loaded says so with a Retry instead of a blank or broken image.
 * Records without `src` (an old client payload) fall back to the stored link.
 * The lightbox is the old board's: click to enlarge, Escape or click to close.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LostFoundPhoto } from "@/lib/lost-found/service";
import { lostFoundPhotoRetrySrc } from "@/lib/lost-found/photo-src";

export type LostFoundPhotoState = "loading" | "loaded" | "failed";

/** The photo's src, its load state and a retry that asks the route again. */
export function useLostFoundPhotoSource(photo: LostFoundPhoto) {
  const base = photo.src || photo.url;
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<LostFoundPhotoState>("loading");
  // A different photo starts over.
  React.useEffect(() => {
    setAttempt(0);
    setState("loading");
  }, [base]);

  const onError = React.useCallback(() => setState("failed"), []);
  const onLoad = React.useCallback(() => setState("loaded"), []);
  const retry = React.useCallback(() => {
    setAttempt((current) => current + 1);
    setState("loading");
  }, []);

  return { url: base ? lostFoundPhotoRetrySrc(base, attempt) : null, state: base ? state : ("failed" as const), onError, onLoad, retry };
}

type ThumbProps = { photo: LostFoundPhoto; alt: string; className?: string; onOpen?: (url: string) => void };

export function LostFoundThumb({ photo, alt, className, onOpen }: ThumbProps) {
  const { url, state, onError, onLoad, retry } = useLostFoundPhotoSource(photo);
  const box = cn("relative flex-none overflow-hidden rounded-[8px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]", className);
  if (!url || state === "failed") {
    return (
      <span className={cn(box, "flex flex-col items-center justify-center gap-0.5 p-0.5 text-center text-[0.625rem] leading-tight text-[hsl(var(--e-muted-foreground))]")} role="img" aria-label={`Photo of ${alt} could not be loaded`}>
        <span>Image could not be loaded</span>
        {url ? (
          <button type="button" onClick={retry} className="font-[600] text-[hsl(var(--e-primary))] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            Retry
          </button>
        ) : null}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img key={url} src={url} alt={alt} onError={onError} onLoad={onLoad} className="h-full w-full object-cover" />;
  if (!onOpen) return <span className={box}>{image}</span>;
  return (
    <button type="button" className={cn(box, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]")} onClick={() => onOpen(url)} aria-label={`Enlarge photo of ${alt}`}>
      {image}
    </button>
  );
}

export function LostFoundLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);
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
      {failed ? (
        <p role="alert" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.875rem] text-[hsl(var(--e-foreground))]">Image could not be loaded. Close and try again.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setFailed(true)} className="max-h-[90vh] max-w-[90vw] rounded-[var(--e-radius)] object-contain" />
      )}
    </div>
  );
}
