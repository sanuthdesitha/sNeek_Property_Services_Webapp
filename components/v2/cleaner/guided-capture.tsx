"use client";

/**
 * Estate v2 guided capture — a fast, mobile-first "keep snapping" surface for
 * grabbing MANY photos per section without leaving the flow.
 *
 * Design (v2-native, simpler than the v1 GuidedCapture):
 *  - Full-screen dark overlay rendered through a portal to <body> so a
 *    transformed/overflow ancestor can't trap position:fixed.
 *  - One or more capture TARGETS (the section's photo fields). A header lets the
 *    cleaner step between targets; the active target title is shown large.
 *  - Two big controls: CAMERA (device camera via <input capture>) and LIBRARY
 *    (multi-select gallery). Both reopen after each batch so the cleaner keeps
 *    snapping without the surface closing.
 *  - A running thumbnail strip shows every shot committed to the active target,
 *    plus live "uploading" spinners.
 *  - All uploads go through the SHARED stamped pipeline (prepareAndUploadFiles) —
 *    evidence stamping is never bypassed.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, ImagePlus, Check, X, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { StampOptions } from "@/lib/uploads/stamp";
import {
  prepareAndUploadFiles,
  type CapturedMedia,
} from "@/components/v2/cleaner/media-capture";

export interface GuidedCaptureTarget {
  fieldId: string;
  label: string;
  /** Required photo count for this target (shows progress; never blocks). */
  minPhotos?: number;
  /** Hard cap on committed media for this target. */
  maxFiles?: number;
}

export function GuidedCapture({
  targets,
  sectionLabel,
  folder,
  stampFor,
  counts,
  thumbnails,
  onCommit,
  onClose,
}: {
  targets: GuidedCaptureTarget[];
  sectionLabel?: string;
  folder: string;
  /** Per-target evidence-stamp context (null disables stamping). */
  stampFor: (fieldId: string) => StampOptions | null;
  /** Live committed count per fieldId (from the parent's uploads state). */
  counts: Record<string, number>;
  /** Live preview URLs per fieldId, newest last. */
  thumbnails: Record<string, string[]>;
  onCommit: (fieldId: string, media: CapturedMedia[]) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = React.useState(() => {
    const firstIncomplete = targets.findIndex(
      (t) => (counts[t.fieldId] ?? 0) < Math.max(1, t.minPhotos ?? 1)
    );
    return firstIncomplete === -1 ? 0 : firstIncomplete;
  });
  const [pending, setPending] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);

  const cameraRef = React.useRef<HTMLInputElement | null>(null);
  const galleryRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const target = targets[index];

  const upload = React.useCallback(
    async (files: File[], source: "camera" | "gallery") => {
      if (!target || files.length === 0) return;
      const fieldId = target.fieldId;
      const max = target.maxFiles;
      let batch = files;
      if (max != null) {
        const room = Math.max(0, max - (counts[fieldId] ?? 0));
        batch = files.slice(0, room);
        if (batch.length === 0) {
          setError("Maximum photos reached for this item.");
          return;
        }
      }
      setError(null);
      setPending((n) => n + batch.length);
      try {
        const { results, failedCount } = await prepareAndUploadFiles(batch, {
          folder,
          stamp: stampFor(fieldId),
          source,
        });
        if (failedCount > 0) setError(`${failedCount} photo(s) failed — try again.`);
        if (results.length > 0) onCommit(fieldId, results);
      } catch (e: any) {
        setError(e?.message || "Upload failed");
      } finally {
        setPending((n) => Math.max(0, n - batch.length));
      }
    },
    [target, counts, folder, stampFor, onCommit]
  );

  if (!mounted || !target) return null;

  const count = counts[target.fieldId] ?? 0;
  const required = Math.max(1, target.minPhotos ?? 1);
  const met = count >= required;
  const thumbs = thumbnails[target.fieldId] ?? [];
  const isLast = index >= targets.length - 1;

  const overlay = (
    <div className="fixed inset-0 z-[120] flex h-[100dvh] flex-col bg-[hsl(160_18%_8%)] text-white">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.currentTarget.value = "";
          void upload(files, "camera");
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.currentTarget.value = "";
          void upload(files, "gallery");
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="min-w-0">
          {sectionLabel ? (
            <p className="truncate text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-white/60">
              {sectionLabel}
            </p>
          ) : null}
          <p className="text-[0.8125rem] font-semibold tabular-nums text-white/90">
            {targets.length > 1 ? `Item ${index + 1} of ${targets.length}` : "Add photos"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close capture"
          className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Active target + progress */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <h2 className="text-2xl font-bold leading-tight">{target.label}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] px-2.5 py-0.5 text-[0.75rem] font-[550] tabular-nums ${
              met ? "bg-[hsl(var(--e-success))] text-white" : "bg-white/15 text-white"
            }`}
          >
            {met ? <Check className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
            {count}
            {required > 0 ? ` / ${required}` : ""} photo{count === 1 ? "" : "s"}
          </span>
          {pending > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] bg-white/15 px-2.5 py-0.5 text-[0.75rem]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pending} uploading
            </span>
          ) : null}
        </div>

        {error ? <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}

        {/* Thumbnail strip */}
        <div className="mt-4">
          {thumbs.length > 0 || pending > 0 ? (
            <div className="flex flex-wrap gap-2">
              {thumbs.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt={`${target.label} ${i + 1}`}
                  className="h-20 w-20 rounded-[var(--e-radius)] border border-white/20 object-cover"
                />
              ))}
              {pending > 0
                ? Array.from({ length: pending }).map((_, i) => (
                    <div
                      key={`pending-${i}`}
                      className="flex h-20 w-20 items-center justify-center rounded-[var(--e-radius)] border border-white/20 bg-white/5"
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-white/70" />
                    </div>
                  ))
                : null}
            </div>
          ) : (
            <p className="text-[0.8125rem] text-white/50">
              No photos yet — tap Camera to start snapping. Keep going; the camera reopens after each shot.
            </p>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="shrink-0 border-t border-white/10 bg-black/40 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-gold))] text-[0.9375rem] font-[600] text-[hsl(var(--e-gold-foreground))] active:scale-[0.98]"
          >
            <Camera className="h-5 w-5" /> Camera
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[var(--e-radius)] border border-white/30 bg-transparent text-[0.9375rem] font-[550] text-white active:scale-[0.98]"
          >
            <ImagePlus className="h-5 w-5" /> Library
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((v) => Math.max(0, v - 1))}
            className="inline-flex h-10 items-center gap-1 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] text-white/80 hover:bg-white/10 disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center gap-1 rounded-[var(--e-radius)] bg-white/15 px-4 text-[0.8125rem] font-[600] text-white hover:bg-white/25"
            >
              Done <Check className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex((v) => Math.min(targets.length - 1, v + 1))}
              className="inline-flex h-10 items-center gap-1 rounded-[var(--e-radius)] bg-white/15 px-4 text-[0.8125rem] font-[600] text-white hover:bg-white/25"
            >
              {met ? "Next" : "Skip"} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
