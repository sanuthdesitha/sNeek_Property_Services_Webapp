"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ImagePlus,
  Loader2,
  MapPin,
  RefreshCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GuidedCaptureItem {
  fieldId: string;
  label: string;
  sectionLabel?: string;
  description?: string;
  locationTag?: string;
  /** Required photo count — auto-advance fires once this is reached (>=1). */
  minPhotos?: number;
  maxFiles?: number;
}

export interface GuidedCaptureProps {
  items: GuidedCaptureItem[];
  /** Uploaded photo count per field id (uploaded + currently uploading). */
  counts: Record<string, number>;
  /** Number of in-flight uploads per field id (shown as spinner chips). */
  pendingCounts: Record<string, number>;
  /** Preview URLs per field id (resolved presigned GETs), newest last. */
  thumbnails: Record<string, string[]>;
  /**
   * Called with the captured files. Must run the regular field upload
   * pipeline (compress → presign → attach keys to the field's value).
   * Resolves with the number of failed files so they can be retried here.
   */
  onFiles: (fieldId: string, files: File[]) => Promise<{ failedCount: number }>;
  onClose: () => void;
}

/**
 * Full-screen "keep shooting" camera flow. Builds on the dependable
 * <input type="file" capture="environment"> pattern: after every shot the
 * input is re-opened automatically so the cleaner just keeps pressing the
 * one big button while the overlay tells them what to photograph next.
 * Failed uploads are kept locally and can be retried without re-shooting.
 */
export function GuidedCapture({
  items,
  counts,
  pendingCounts,
  thumbnails,
  onFiles,
  onClose,
}: GuidedCaptureProps) {
  const [index, setIndex] = React.useState(() => {
    // Start on the first field that still needs photos.
    const firstIncomplete = items.findIndex(
      (item) => (item.minPhotos ?? 1) > 0 && (counts[item.fieldId] ?? 0) < (item.minPhotos ?? 1)
    );
    return firstIncomplete === -1 ? 0 : firstIncomplete;
  });
  // "+1 more" override: suppress auto-advance for this field until it fires once.
  const [stayFieldId, setStayFieldId] = React.useState<string | null>(null);
  // Files that failed to upload, retryable per field.
  const [failedFiles, setFailedFiles] = React.useState<Record<string, File[]>>({});
  const [retrying, setRetrying] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const advanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = items[index];
  const total = items.length;

  React.useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  if (!item) return null;

  const count = counts[item.fieldId] ?? 0;
  const pending = pendingCounts[item.fieldId] ?? 0;
  const required = Math.max(0, item.minPhotos ?? 1);
  const maxFiles = item.maxFiles;
  const atMax = maxFiles !== undefined && count >= maxFiles;
  const met = required === 0 ? count > 0 : count >= required;
  const thumbs = thumbnails[item.fieldId] ?? [];
  const failed = failedFiles[item.fieldId] ?? [];
  const completedFields = items.filter((it) => {
    const c = counts[it.fieldId] ?? 0;
    const req = Math.max(0, it.minPhotos ?? 1);
    return req === 0 ? c > 0 : c >= req;
  }).length;
  const progressPct = total > 0 ? Math.round((completedFields / total) * 100) : 0;

  function goTo(nextIndex: number) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setStayFieldId(null);
    setIndex(Math.min(total - 1, Math.max(0, nextIndex)));
  }

  function openCamera() {
    inputRef.current?.click();
  }

  async function handleFiles(files: File[], fieldId: string) {
    if (files.length === 0) return;
    const result = await onFiles(fieldId, files).catch(() => ({ failedCount: files.length }));
    if (result.failedCount > 0) {
      // Keep the tail of the batch for retry — uploads run in order, so the
      // failed ones are the last N files.
      const kept = files.slice(files.length - result.failedCount);
      setFailedFiles((prev) => ({ ...prev, [fieldId]: [...(prev[fieldId] ?? []), ...kept] }));
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.currentTarget.value = "";
    if (files.length === 0) return;
    const fieldId = item.fieldId;
    const requiredHere = Math.max(0, item.minPhotos ?? 1);
    const newCount = (counts[fieldId] ?? 0) + files.length;
    void handleFiles(files, fieldId);

    const wantsToStay = stayFieldId === fieldId;
    const reached = requiredHere > 0 && newCount >= requiredHere;
    const reachedMax = item.maxFiles !== undefined && newCount >= item.maxFiles;

    if ((reached || reachedMax) && !wantsToStay && index < total - 1) {
      // Auto-advance to the next requirement, straight on the capture button.
      advanceTimer.current = setTimeout(() => {
        setStayFieldId(null);
        setIndex((prev) => Math.min(total - 1, prev + 1));
      }, 650);
    } else if (!reachedMax) {
      // Stay on this field and immediately re-open the camera for the next shot.
      if (wantsToStay) setStayFieldId(null);
      advanceTimer.current = setTimeout(() => inputRef.current?.click(), 350);
    }
  }

  async function retryFailed() {
    const files = failedFiles[item.fieldId] ?? [];
    if (files.length === 0 || retrying) return;
    setRetrying(true);
    setFailedFiles((prev) => ({ ...prev, [item.fieldId]: [] }));
    await handleFiles(files, item.fieldId);
    setRetrying(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Hidden persistent camera input, re-triggered after every shot. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={onInputChange}
      />

      {/* Header: progress */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold tabular-nums">
            Field {index + 1} of {total} · {progressPct}%
          </p>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={onClose} aria-label="Exit guided capture">
            <X className="size-5" />
          </Button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Current target */}
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          {item.sectionLabel ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {item.sectionLabel}
            </p>
          ) : null}
          <h2 className="text-2xl font-bold leading-tight">{item.label}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.locationTag ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <MapPin className="size-3" />
                {item.locationTag}
              </span>
            ) : null}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
                met ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
              }`}
            >
              {met ? <Check className="size-3" /> : <Camera className="size-3" />}
              {count}
              {required > 0 ? ` / ${required}` : ""} photo{count === 1 ? "" : "s"}
            </span>
            {pending > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {pending} uploading
              </span>
            ) : null}
          </div>
          {item.description ? (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          ) : null}
        </div>

        {/* Thumbnails strip */}
        {thumbs.length > 0 ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {thumbs.map((url, i) => (
              <img
                key={`${url}-${i}`}
                src={url}
                alt={`${item.label} photo ${i + 1}`}
                className="h-20 w-20 shrink-0 rounded-lg border object-cover"
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 flex h-24 items-center justify-center rounded-xl border-2 border-dashed text-xs text-muted-foreground">
            No photos for this field yet — press the big button below.
          </div>
        )}

        {failed.length > 0 ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
            <p className="text-xs text-destructive">
              {failed.length} photo{failed.length === 1 ? "" : "s"} failed to upload (kept on device).
            </p>
            <Button type="button" size="sm" variant="outline" className="h-9" onClick={retryFailed} disabled={retrying}>
              {retrying ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCcw className="mr-1 size-3.5" />}
              Retry
            </Button>
          </div>
        ) : null}

        {met && index < total - 1 ? (
          <button
            type="button"
            className="mt-3 self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => {
              setStayFieldId(item.fieldId);
              openCamera();
            }}
          >
            +1 more for this field
          </button>
        ) : null}
      </div>

      {/* Controls */}
      <div className="space-y-3 border-t px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
        <Button
          type="button"
          className="h-14 w-full text-base font-semibold"
          onClick={openCamera}
          disabled={atMax}
        >
          <ImagePlus className="mr-2 size-5" />
          {atMax ? "Max photos reached" : count > 0 ? "Capture another photo" : "Capture photo"}
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
          >
            <ArrowLeft className="mr-1 size-4" />
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1"
            disabled={index >= total - 1}
            onClick={() => goTo(index + 1)}
          >
            Skip
          </Button>
          {index >= total - 1 ? (
            <Button type="button" className="h-11 flex-1" onClick={onClose}>
              Done
              <Check className="ml-1 size-4" />
            </Button>
          ) : (
            <Button type="button" className="h-11 flex-1" onClick={() => goTo(index + 1)}>
              Next field
              <ArrowRight className="ml-1 size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
