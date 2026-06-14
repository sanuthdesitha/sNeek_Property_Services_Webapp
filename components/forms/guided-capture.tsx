"use client";

import * as React from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  CircleDot,
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
   * pipeline (stamp → compress → presign → attach keys to the field's value).
   * Resolves with the number of failed files so they can be retried here.
   * `source` lets the page choose camera vs gallery handling.
   */
  onFiles: (
    fieldId: string,
    files: File[],
    source: "camera" | "gallery"
  ) => Promise<{ failedCount: number }>;
  onClose: () => void;
}

/**
 * Full-screen "keep shooting" camera flow.
 *
 * Primary path: a live getUserMedia rear-camera preview fills the middle of the
 * overlay with the current target title overlaid. A big shutter button grabs a
 * frame from the stream (canvas → JPEG), runs it through onFiles, and stays
 * live for the next shot — auto-advancing once minPhotos is met. A second
 * button uploads existing images from the gallery (also stamped upstream).
 *
 * Fallback path: when getUserMedia is unavailable or denied (iOS quirks, no
 * permission), it degrades to the dependable <input capture="environment">
 * pattern, re-opened after each shot. Failed uploads are kept locally for retry
 * without re-shooting.
 *
 * Layout: fixed full-screen, no page scroll — header (progress + close), the
 * live preview filling the middle with the target title, a horizontally
 * scrolling thumbnails strip, and a fixed bottom action bar.
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
    const firstIncomplete = items.findIndex(
      (item) => (item.minPhotos ?? 1) > 0 && (counts[item.fieldId] ?? 0) < (item.minPhotos ?? 1)
    );
    return firstIncomplete === -1 ? 0 : firstIncomplete;
  });
  // "+1 more" override: suppress auto-advance for this field until it fires once.
  const [stayFieldId, setStayFieldId] = React.useState<string | null>(null);
  const [failedFiles, setFailedFiles] = React.useState<Record<string, File[]>>({});
  const [retrying, setRetrying] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);

  // Live-camera state.
  const [liveReady, setLiveReady] = React.useState(false);
  const [useFallback, setUseFallback] = React.useState(false);
  const [starting, setStarting] = React.useState(true);
  const [flash, setFlash] = React.useState(false);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const cameraInputRef = React.useRef<HTMLInputElement | null>(null);
  const galleryInputRef = React.useRef<HTMLInputElement | null>(null);
  const advanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = items[index];
  const total = items.length;
  const indexRef = React.useRef(index);
  indexRef.current = index;

  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Live camera lifecycle ----
  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLiveReady(false);
  }, []);

  /**
   * Attach an active MediaStream to the (always-mounted) <video> element and
   * play it. Kept separate from acquisition so it can run from an effect once
   * the element is guaranteed mounted — fixing the "stream attached before ref
   * ready / video hidden" class of bugs where the preview never appeared.
   */
  const attachStream = React.useCallback(async (stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    // muted + playsInline are required for autoplay on iOS/Safari; set them on
    // the element too (not just as attributes) so play() isn't blocked.
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      // Autoplay can reject if the gesture/visibility isn't ready yet; a retry
      // on the next tick (element is mounted, attributes set) usually succeeds.
      await new Promise((r) => setTimeout(r, 60));
      await video.play().catch(() => undefined);
    }
  }, []);

  const startStream = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setUseFallback(true);
      setStarting(false);
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setUseFallback(false);
      // The <video> is always mounted, so attach immediately; a dedicated
      // effect also re-attaches if the ref settles after this resolves.
      await attachStream(stream);
      setLiveReady(true);
    } catch {
      // Denied / unavailable (common on iOS in some webviews) — degrade.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setUseFallback(true);
      setLiveReady(false);
    } finally {
      setStarting(false);
    }
  }, [attachStream]);

  React.useEffect(() => {
    void startStream();
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Belt-and-braces: whenever a stream exists and live mode is on, make sure it
  // is bound to the video element (handles ref/layout settling after acquire).
  React.useEffect(() => {
    if (streamRef.current && !useFallback) {
      void attachStream(streamRef.current);
    }
  }, [useFallback, attachStream, liveReady]);

  const retryCamera = React.useCallback(() => {
    setUseFallback(false);
    setLiveReady(false);
    void startStream();
  }, [startStream]);

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

  function scheduleAfterShot(fieldId: string, addedCount: number) {
    const itemNow = items[indexRef.current];
    if (!itemNow || itemNow.fieldId !== fieldId) return;
    const requiredHere = Math.max(0, itemNow.minPhotos ?? 1);
    const newCount = (counts[fieldId] ?? 0) + addedCount;
    const wantsToStay = stayFieldId === fieldId;
    const reached = requiredHere > 0 && newCount >= requiredHere;
    const reachedMax = itemNow.maxFiles !== undefined && newCount >= itemNow.maxFiles;

    if ((reached || reachedMax) && !wantsToStay && indexRef.current < total - 1) {
      advanceTimer.current = setTimeout(() => {
        setStayFieldId(null);
        setIndex((prev) => Math.min(total - 1, prev + 1));
      }, 650);
    } else if (wantsToStay) {
      setStayFieldId(null);
    }
  }

  async function handleFiles(files: File[], fieldId: string, source: "camera" | "gallery") {
    if (files.length === 0) return;
    const result = await onFiles(fieldId, files, source).catch(() => ({ failedCount: files.length }));
    if (result.failedCount > 0) {
      const kept = files.slice(files.length - result.failedCount);
      setFailedFiles((prev) => ({ ...prev, [fieldId]: [...(prev[fieldId] ?? []), ...kept] }));
    }
  }

  // ---- Live shutter: grab a frame from the video stream ----
  async function captureFromStream() {
    const video = videoRef.current;
    if (!video || !liveReady || capturing || atMax) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    setCapturing(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), reduceMotion ? 0 : 140);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setCapturing(false);
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) {
        setCapturing(false);
        return;
      }
      const file = new File([blob], `capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      const fieldId = item.fieldId;
      // Fire-and-forget the upload (stamped + compressed upstream); keep the
      // preview live so the cleaner can immediately take the next shot.
      void handleFiles([file], fieldId, "camera");
      scheduleAfterShot(fieldId, 1);
    } finally {
      setCapturing(false);
    }
  }

  // ---- Fallback file-input handlers ----
  function onCameraInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.currentTarget.value = "";
    if (files.length === 0) return;
    const fieldId = item.fieldId;
    void handleFiles(files, fieldId, "camera");
    scheduleAfterShot(fieldId, files.length);
  }

  function onGalleryInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.currentTarget.value = "";
    if (files.length === 0) return;
    const fieldId = item.fieldId;
    void handleFiles(files, fieldId, "gallery");
    scheduleAfterShot(fieldId, files.length);
  }

  function onShutterClick() {
    if (useFallback || !liveReady) {
      cameraInputRef.current?.click();
      return;
    }
    void captureFromStream();
  }

  async function retryFailed() {
    const files = failedFiles[item.fieldId] ?? [];
    if (files.length === 0 || retrying) return;
    setRetrying(true);
    setFailedFiles((prev) => ({ ...prev, [item.fieldId]: [] }));
    await handleFiles(files, item.fieldId, "camera");
    setRetrying(false);
  }

  const shutterDisabled = atMax || capturing;

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-black text-white">
      {/* Hidden inputs for the fallback + gallery paths. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={onCameraInputChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onGalleryInputChange}
      />

      {/* Header: progress + close. */}
      <div className="shrink-0 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold tabular-nums">
            Field {index + 1} of {total} · {progressPct}%
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-white hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="Exit guided capture"
          >
            <X className="size-5" />
          </Button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div
            className={`h-full rounded-full bg-primary ${reduceMotion ? "" : "transition-all"}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Live preview area (fills the middle). The <video> is ALWAYS mounted so
          the stream can attach reliably; fallback/loading states sit on top. */}
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full bg-black object-cover ${
            useFallback ? "invisible" : ""
          }`}
          muted
          playsInline
          autoPlay
        />

        {/* Acquiring the camera. */}
        {!useFallback && starting && !liveReady ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900/90 px-6 text-center">
            <Loader2 className={`size-8 text-white/70 ${reduceMotion ? "" : "animate-spin"}`} />
            <p className="text-sm text-white/70">Starting camera…</p>
          </div>
        ) : null}

        {/* Camera unavailable / denied fallback. */}
        {useFallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 px-6 text-center">
            <Camera className="size-10 text-white/50" />
            <p className="text-sm font-medium text-white/80">Camera unavailable</p>
            <p className="max-w-xs text-xs text-white/60">
              We couldn&apos;t open the live camera. Tap the shutter to use your device camera, or
              retry the live preview.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={retryCamera}
            >
              <RefreshCcw className="mr-1 size-3.5" />
              Retry live camera
            </Button>
          </div>
        ) : null}

        {/* Shutter flash. */}
        {flash ? <div className="absolute inset-0 bg-white/80" aria-hidden /> : null}

        {/* Target title overlay (top of preview). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-4">
          {item.sectionLabel ? (
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">
              {item.sectionLabel}
            </p>
          ) : null}
          <h2 className="text-2xl font-bold leading-tight drop-shadow">{item.label}</h2>
          {item.description ? (
            <p className="mt-1 text-sm text-white/85 drop-shadow">{item.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.locationTag ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs font-medium text-white">
                <MapPin className="size-3" />
                {item.locationTag}
              </span>
            ) : null}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
                met ? "bg-success/80 text-white" : "bg-white/15 text-white"
              }`}
            >
              {met ? <Check className="size-3" /> : <Camera className="size-3" />}
              {count}
              {required > 0 ? ` / ${required}` : ""} photo{count === 1 ? "" : "s"}
            </span>
            {pending > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs text-white">
                <Loader2 className={`size-3 ${reduceMotion ? "" : "animate-spin"}`} />
                {pending} uploading
              </span>
            ) : null}
          </div>
        </div>

        {/* Failed-upload retry banner (over the preview, tappable). */}
        {failed.length > 0 ? (
          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-lg border border-destructive/50 bg-black/70 px-3 py-2 backdrop-blur">
            <p className="text-xs text-red-300">
              {failed.length} photo{failed.length === 1 ? "" : "s"} failed (kept on device).
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 border-white/30 bg-transparent text-white hover:bg-white/10"
              onClick={retryFailed}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className={`mr-1 size-3.5 ${reduceMotion ? "" : "animate-spin"}`} />
              ) : (
                <RefreshCcw className="mr-1 size-3.5" />
              )}
              Retry
            </Button>
          </div>
        ) : null}
      </div>

      {/* Thumbnails strip (the only scrollable region). */}
      <div className="shrink-0 px-3 py-2">
        {thumbs.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {thumbs.map((url, i) => (
              <img
                key={`${url}-${i}`}
                src={url}
                alt={`${item.label} photo ${i + 1}`}
                className="h-16 w-16 shrink-0 rounded-lg border border-white/20 object-cover"
              />
            ))}
            {pending > 0 ? (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/5">
                <Loader2 className={`size-5 text-white/70 ${reduceMotion ? "" : "animate-spin"}`} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-1 text-center text-xs text-white/50">
            No photos for this field yet — press the shutter below.
          </p>
        )}
      </div>

      {/* Fixed bottom action bar. */}
      <div className="shrink-0 border-t border-white/10 bg-black/60 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          {/* Gallery upload. */}
          <Button
            type="button"
            variant="outline"
            className="h-12 flex-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
            onClick={() => galleryInputRef.current?.click()}
            disabled={atMax}
          >
            <ImagePlus className="mr-2 size-5" />
            Gallery
          </Button>

          {/* Shutter. */}
          <button
            type="button"
            onClick={onShutterClick}
            disabled={shutterDisabled}
            aria-label={atMax ? "Max photos reached" : "Capture photo"}
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-white ${
              reduceMotion ? "" : "transition-transform active:scale-95"
            } ${shutterDisabled ? "opacity-40" : "bg-white/10"}`}
          >
            {capturing ? (
              <Loader2 className={`size-7 ${reduceMotion ? "" : "animate-spin"}`} />
            ) : (
              <CircleDot className="size-9" />
            )}
          </button>

          {/* Advance / done. */}
          {index >= total - 1 ? (
            <Button
              type="button"
              className="h-12 flex-1"
              onClick={onClose}
            >
              Done
              <Check className="ml-1 size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-12 flex-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => goTo(index + 1)}
            >
              {met ? "Next" : "Skip"}
            </Button>
          )}
        </div>

        {/* Back + "+1 more" row. */}
        <div className="mt-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 text-white/80 hover:bg-white/10 hover:text-white"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
          >
            <ArrowLeft className="mr-1 size-4" />
            Back
          </Button>
          {met && index < total - 1 ? (
            <button
              type="button"
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setStayFieldId(item.fieldId)}
            >
              Keep shooting this field
            </button>
          ) : (
            <span className="text-[11px] text-white/40">
              {atMax ? "Max photos reached" : "Tap the shutter to capture"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
