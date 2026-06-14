"use client";

import * as React from "react";
import { Video, Square, Loader2, Upload, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface VideoRecorderProps {
  /** Capturer name burned into the live timestamp overlay. */
  capturerName?: string;
  /** IANA timezone for the timestamp. Defaults to Australia/Sydney. */
  timezone?: string;
  /** Max recording length in seconds (auto-stop). Defaults to 60. */
  maxDurationSec?: number;
  /**
   * Upload the recorded clip through the page's existing video upload path
   * (direct multipart for large videos). Resolves when the upload settles.
   */
  onRecorded: (file: File) => Promise<void> | void;
  /** Disable while the field is at its max file count. */
  disabled?: boolean;
}

const DEFAULT_TZ = "Australia/Sydney";

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function extForMime(mime: string | undefined): string {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

/**
 * In-app video recording with a burned-in timestamp.
 *
 * The camera stream is drawn frame-by-frame onto a canvas with a live
 * timestamp + capturer overlay; MediaRecorder captures the CANVAS stream (not
 * the raw camera), so the saved video permanently carries the timestamp
 * watermark. Audio is mixed in from the camera stream's audio track. Auto-stops
 * at maxDurationSec.
 *
 * Falls back to <input type="file" accept="video/*" capture> when getUserMedia
 * or MediaRecorder is unavailable.
 */
export function VideoRecorder({
  capturerName,
  timezone,
  maxDurationSec = 60,
  onRecorded,
  disabled,
}: VideoRecorderProps) {
  const [supported] = React.useState(
    () =>
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
  const [recording, setRecording] = React.useState(false);
  const [preparing, setPreparing] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  const previewRef = React.useRef<HTMLVideoElement | null>(null);
  const hiddenVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const canvasStreamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<BlobPart[]>([]);
  const rafRef = React.useRef<number>(0);
  const startedAtRef = React.useRef<number>(0);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInputRef = React.useRef<HTMLInputElement | null>(null);
  const mimeRef = React.useRef<string | undefined>(undefined);

  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cleanup = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
    canvasStreamRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  React.useEffect(() => cleanup, [cleanup]);

  function formatTimestamp(): string {
    try {
      return new Intl.DateTimeFormat("en-AU", {
        timeZone: timezone || DEFAULT_TZ,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(new Date());
    } catch {
      return new Date().toLocaleString("en-AU");
    }
  }

  function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const scale = w / 1000;
    const pad = Math.max(10, Math.round(16 * scale));
    const fontSize = Math.max(14, Math.round(22 * scale));
    const lineGap = Math.round(fontSize * 0.4);
    const name = (capturerName || "Cleaner").trim() || "Cleaner";
    const stamp = formatTimestamp();
    const lines = [name, stamp];

    ctx.font = `600 ${fontSize}px Arial, Helvetica, sans-serif`;
    const bandHeight = lines.length * fontSize + (lines.length - 1) * lineGap + pad * 2;
    const bandY = h - bandHeight;

    const gradient = ctx.createLinearGradient(0, bandY, 0, h);
    gradient.addColorStop(0, "rgba(8,11,20,0)");
    gradient.addColorStop(1, "rgba(8,11,20,0.78)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, bandY, w, bandHeight);

    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = Math.max(2, Math.round(3 * scale));
    let y = bandY + pad;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.fillText(name, pad, y);
    y += fontSize + lineGap;
    ctx.font = `500 ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(stamp, pad, y);
    ctx.shadowBlur = 0;

    // REC dot + company mark top-right while recording.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    const mark = "sNeek";
    const markWidth = ctx.measureText(mark).width;
    ctx.fillText(mark, w - pad - markWidth, pad);
  }

  async function startRecording() {
    setError(null);
    if (!supported) {
      fallbackInputRef.current?.click();
      return;
    }
    setPreparing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;

      const source = hiddenVideoRef.current;
      const canvas = canvasRef.current;
      if (!source || !canvas) {
        cleanup();
        setPreparing(false);
        return;
      }
      source.srcObject = stream;
      source.muted = true;
      await source.play().catch(() => undefined);

      const w = source.videoWidth || 1280;
      const h = source.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        setPreparing(false);
        return;
      }

      // Live preview mirrors the canvas (so the user sees the burned overlay).
      const fps = 30;
      const canvasStream = canvas.captureStream(fps);
      canvasStreamRef.current = canvasStream;
      // Mix the camera audio into the canvas-derived stream.
      stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));

      const preview = previewRef.current;
      if (preview) {
        preview.srcObject = canvasStream;
        preview.muted = true;
        await preview.play().catch(() => undefined);
      }

      const mime = pickMimeType();
      mimeRef.current = mime;
      const recorder = mime ? new MediaRecorder(canvasStream, { mimeType: mime }) : new MediaRecorder(canvasStream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recordedMime = mimeRef.current ?? recorder.mimeType ?? "video/webm";
        const blob = new Blob(chunksRef.current, { type: recordedMime });
        chunksRef.current = [];
        cleanup();
        setRecording(false);
        setElapsed(0);
        if (blob.size > 0) {
          const file = new File([blob], `recording-${Date.now()}.${extForMime(recordedMime)}`, {
            type: recordedMime,
            lastModified: Date.now(),
          });
          setUploading(true);
          Promise.resolve(onRecorded(file)).finally(() => setUploading(false));
        }
      };

      // Drive the canvas: draw the camera frame + overlay every animation frame.
      const render = () => {
        if (!streamRef.current) return;
        try {
          ctx.drawImage(source, 0, 0, w, h);
          drawOverlay(ctx, w, h);
        } catch {
          // transient draw error — keep going
        }
        rafRef.current = requestAnimationFrame(render);
      };
      rafRef.current = requestAnimationFrame(render);

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setRecording(true);
      setPreparing(false);

      const limit = Math.max(1, maxDurationSec || 60);
      autoStopRef.current = setTimeout(() => stopRecording(), limit * 1000);
    } catch {
      cleanup();
      setPreparing(false);
      setError("Could not access the camera — upload a video instead.");
    }
  }

  function stopRecording() {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        cleanup();
        setRecording(false);
      }
    } else {
      cleanup();
      setRecording(false);
    }
  }

  // Tick the elapsed display while recording.
  React.useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [recording]);

  const remaining = Math.max(0, (maxDurationSec || 60) - elapsed);

  return (
    <div className="space-y-2">
      {/* Hidden source video (camera) feeding the canvas. */}
      <video ref={hiddenVideoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {recording || preparing ? (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={previewRef} className="h-52 w-full object-contain" muted playsInline />
          {recording ? (
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
              <Circle className={`size-3 fill-red-500 text-red-500 ${reduceMotion ? "" : "animate-pulse"}`} />
              <span className="tabular-nums">
                {pad2(Math.floor(elapsed / 60))}:{pad2(elapsed % 60)}
              </span>
              <span className="text-white/60">/ {remaining}s left</span>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <Loader2 className={`size-6 ${reduceMotion ? "" : "animate-spin"}`} />
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 flex-1"
            onClick={startRecording}
            disabled={disabled || preparing || uploading}
          >
            {uploading ? (
              <Loader2 className={`mr-2 size-4 ${reduceMotion ? "" : "animate-spin"}`} />
            ) : (
              <Video className="mr-2 size-4" />
            )}
            {uploading ? "Uploading…" : "Record video"}
          </Button>
        ) : (
          <Button type="button" variant="destructive" className="h-12 flex-1" onClick={stopRecording}>
            <Square className="mr-2 size-4" />
            Stop &amp; save
          </Button>
        )}

        {/* Fallback / explicit gallery upload. */}
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => fallbackInputRef.current?.click()}
          disabled={disabled || recording || uploading}
        >
          <Upload className="mr-2 size-4" />
          Upload
        </Button>
        <input
          ref={fallbackInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setUploading(true);
            Promise.resolve(onRecorded(file)).finally(() => setUploading(false));
          }}
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!supported ? (
        <p className="text-[11px] text-muted-foreground">
          Live recording is not available on this device — use Upload to attach a video.
        </p>
      ) : null}
    </div>
  );
}
