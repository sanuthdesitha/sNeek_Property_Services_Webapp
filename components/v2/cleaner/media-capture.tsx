"use client";

/**
 * Estate media capture — native photo/video capture + file picker that posts to
 * the SAME upload endpoint v1 uses (`POST /api/uploads/direct`, multipart with
 * `file` + `folder`, returns `{ key, url }`). Stores the returned S3 *keys*,
 * which is exactly what the job submit endpoint expects under
 * `data.uploads[fieldId]`.
 *
 * Evidence stamping (parity with v1): photos taken with the in-app CAMERA are
 * burned with the same `stampImage` overlay v1 uses (big time, date, weekday,
 * address/GPS, company logo, context tag) via `prepareUploadFile` from
 * `lib/uploads/compress`. GALLERY picks already carry their own timestamp, so
 * they are compressed only — never stamped (v1's no-double-stamp rule). Videos
 * and documents pass through untouched (never stamped) but ARE uploaded and
 * compressed server-side.
 *
 * On mobile the `capture` attribute opens the camera directly; on desktop it
 * falls back to the file picker. Multiple files upload in parallel; each shows a
 * live thumbnail (video fields get a real inline <video> preview) with a remove
 * control, and every committed shot opens in a swipeable lightbox.
 * Zero dependency on v1 UI.
 */
import * as React from "react";
import {
  Camera,
  Video,
  Upload,
  X,
  Loader2,
  FileText,
  Play,
  ChevronLeft,
  ChevronRight,
  Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { prepareUploadFile } from "@/lib/uploads/compress";
import { isStampableImage, type StampGps, type StampOptions } from "@/lib/uploads/stamp";
import { getAccuratePosition } from "@/lib/geo/get-position";

export interface CapturedMedia {
  key: string;
  url: string;
  kind: "image" | "video" | "file";
  name?: string;
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|mpe?g)$/i;

function kindForFile(file: File): CapturedMedia["kind"] {
  if (file.type.startsWith("image/") || IMAGE_RE.test(file.name)) return "image";
  if (file.type.startsWith("video/") || VIDEO_RE.test(file.name)) return "video";
  return "file";
}

/** Best-effort media kind from a stored key/url when the File is long gone. */
export function kindForUrl(url: string): CapturedMedia["kind"] {
  if (VIDEO_RE.test(url)) return "video";
  if (IMAGE_RE.test(url)) return "image";
  return "file";
}

/* ── Evidence-stamp plumbing (same sources as v1: /api/public/branding + GPS) ── */

type Branding = {
  companyName?: string;
  logoUrl?: string;
  evidenceStamp?: { dateFormat?: string; timeFormat?: string; showWeekday?: boolean };
};

let brandingPromise: Promise<Branding> | null = null;
function getBranding(): Promise<Branding> {
  if (!brandingPromise) {
    brandingPromise = fetch("/api/public/branding", { cache: "force-cache" })
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return brandingPromise;
}

/** Cached GPS fix — reused across shots so a burst of captures shares one fix. */
const GPS_TTL_MS = 5 * 60 * 1000;
let gpsCache: { fix: StampGps | null; at: number } | null = null;
let gpsPromise: Promise<StampGps | null> | null = null;
function resolveStampGps(): Promise<StampGps | null> {
  if (gpsCache && Date.now() - gpsCache.at < GPS_TTL_MS) return Promise.resolve(gpsCache.fix);
  if (!gpsPromise) {
    gpsPromise = getAccuratePosition()
      .then((fix) => {
        const value =
          Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng)
            ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null }
            : null;
        gpsCache = { fix: value, at: Date.now() };
        return value;
      })
      .catch(() => {
        gpsCache = { fix: null, at: Date.now() };
        return null;
      })
      .finally(() => {
        gpsPromise = null;
      });
  }
  return gpsPromise;
}

/**
 * Base evidence-stamp options (branding + timestamp format + GPS), merged with
 * caller context. Exported so other v2 capture paths (e.g. QA workspace) can
 * stamp identically without duplicating the branding/GPS plumbing.
 */
export async function buildEvidenceStamp(extra?: StampOptions | null): Promise<StampOptions> {
  const [branding, gps] = await Promise.all([getBranding(), resolveStampGps()]);
  return {
    companyName: branding.companyName?.trim() || "sNeek Property Services",
    logoUrl: branding.logoUrl || "",
    timezone: "Australia/Sydney",
    dateFormat: branding.evidenceStamp?.dateFormat,
    timeFormat: branding.evidenceStamp?.timeFormat,
    showWeekday: typeof branding.evidenceStamp?.showWeekday === "boolean" ? branding.evidenceStamp.showWeekday : undefined,
    gps,
    ...(extra ?? {}),
  };
}

export type CaptureSource = "camera" | "gallery";

/**
 * v1-parity preprocessing: camera photos get the evidence stamp burnt in;
 * gallery images are compressed only (they already carry their own timestamp);
 * videos/documents pass through untouched. Never throws.
 */
async function prepareCapturedFile(
  file: File,
  source: CaptureSource,
  stamp: StampOptions | null | undefined
): Promise<File> {
  if (!isStampableImage(file)) return file;
  try {
    if (source === "camera" && stamp !== null) {
      return await prepareUploadFile(file, await buildEvidenceStamp(stamp));
    }
    // Uploaded image — don't double-stamp; just size it for upload.
    return await prepareUploadFile(file, null);
  } catch {
    return file;
  }
}

async function uploadOne(file: File, folder: string): Promise<CapturedMedia> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Upload failed");
  }
  const data = (await res.json()) as { key: string; url: string };
  return { key: data.key, url: data.url, kind: kindForFile(file), name: file.name };
}

/**
 * Shared stamp → compress → upload pipeline for a batch of files. Reused by both
 * MediaCapture and the guided capture surface so evidence stamping is never
 * bypassed. Uploads run in parallel; resolves with the successful media plus a
 * failed count (never rejects).
 */
export async function prepareAndUploadFiles(
  files: File[],
  opts: { folder: string; stamp?: StampOptions | null; source: CaptureSource }
): Promise<{ results: CapturedMedia[]; failedCount: number }> {
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const prepared = await prepareCapturedFile(file, opts.source, opts.stamp);
      return uploadOne(prepared, opts.folder);
    })
  );
  const results: CapturedMedia[] = [];
  let failedCount = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else failedCount += 1;
  }
  return { results, failedCount };
}

/* ── Swipeable media lightbox (shared with the form renderer) ───────────────── */

export interface LightboxItem {
  url: string;
  kind?: CapturedMedia["kind"];
  caption?: string;
}

export function MediaLightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const count = items.length;
  const current = items[index];
  const touchX = React.useRef<number | null>(null);

  const go = React.useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!current) return null;
  const kind = current.kind ?? kindForUrl(current.url);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="Previous"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Next"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      ) : null}

      <figure
        className="flex max-h-full max-w-full flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "video" ? (
          <video
            src={current.url}
            controls
            playsInline
            autoPlay
            className="max-h-[80vh] max-w-full rounded-[var(--e-radius)] bg-black object-contain"
          />
        ) : kind === "file" ? (
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-center gap-2 rounded-[var(--e-radius)] bg-white/10 px-8 py-10 text-white"
          >
            <FileText className="h-10 w-10" />
            <span className="text-[0.8125rem] underline">Open file</span>
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={current.caption || "media"}
            className="max-h-[80vh] max-w-full rounded-[var(--e-radius)] object-contain"
          />
        )}
        <figcaption className="flex items-center gap-3 text-[0.8125rem] text-white/80">
          {count > 1 ? (
            <span className="tabular-nums">
              {index + 1} / {count}
            </span>
          ) : null}
          {current.caption ? <span>{current.caption}</span> : null}
        </figcaption>
      </figure>
    </div>
  );
}

export function MediaCapture({
  value,
  onChange,
  mode = "photo",
  folder = "uploads",
  multiple = true,
  minPhotos,
  disabled = false,
  stamp,
  error = false,
}: {
  value: CapturedMedia[];
  onChange: (next: CapturedMedia[]) => void;
  /** photo → camera + gallery; video → recorder + library; both → all; file → any document. */
  mode?: "photo" | "video" | "both" | "file";
  folder?: string;
  multiple?: boolean;
  minPhotos?: number;
  disabled?: boolean;
  /**
   * Extra evidence-stamp context (address, reference, contextLabel, tag…)
   * merged over the branding/GPS base. Omit for the default stamp; pass `null`
   * to disable stamping (non-evidence uploads).
   */
  stamp?: StampOptions | null;
  /** Draw an error ring (required-field validation failed). */
  error?: boolean;
}) {
  const [busy, setBusy] = React.useState(0);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [lightbox, setLightbox] = React.useState<number | null>(null);

  const handleFiles = React.useCallback(
    async (files: FileList | null, source: CaptureSource) => {
      if (!files || files.length === 0) return;
      setUploadError(null);
      const list = Array.from(files);
      setBusy((n) => n + list.length);
      let current = value;
      try {
        const { results, failedCount } = await prepareAndUploadFiles(list, { folder, stamp, source });
        if (failedCount > 0) setUploadError(`${failedCount} file(s) failed to upload.`);
        if (results.length > 0) {
          current = multiple ? [...current, ...results] : results.slice(-1);
          onChange(current);
        }
      } catch (e: any) {
        setUploadError(e?.message || "Upload failed");
      } finally {
        setBusy((n) => Math.max(0, n - list.length));
      }
    },
    [folder, multiple, onChange, value, stamp]
  );

  function remove(key: string) {
    onChange(value.filter((m) => m.key !== key));
  }

  const wantPhoto = mode === "photo" || mode === "both";
  const wantVideo = mode === "video" || mode === "both";
  const wantFile = mode === "file";
  const need = minPhotos ?? 0;
  const short = need > 0 && value.filter((m) => m.kind === "image").length < need;

  const lightboxItems: LightboxItem[] = value.map((m) => ({
    url: m.url,
    kind: m.kind,
    caption: m.name,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {wantPhoto ? (
          <CaptureButton
            label="Take photo"
            icon={<Camera className="h-4 w-4" />}
            accept="image/*"
            capture="environment"
            multiple={multiple}
            disabled={disabled}
            onFiles={handleFiles}
          />
        ) : null}
        {wantPhoto ? (
          <CaptureButton
            label="Choose image"
            icon={<Upload className="h-4 w-4" />}
            accept="image/*"
            multiple={multiple}
            disabled={disabled}
            onFiles={handleFiles}
          />
        ) : null}
        {wantVideo ? (
          <CaptureButton
            label="Record video"
            icon={<Video className="h-4 w-4" />}
            accept="video/*"
            capture="environment"
            multiple={multiple}
            disabled={disabled}
            onFiles={handleFiles}
          />
        ) : null}
        {wantVideo ? (
          <CaptureButton
            label="Choose video"
            icon={<Film className="h-4 w-4" />}
            accept="video/*"
            multiple={multiple}
            disabled={disabled}
            onFiles={handleFiles}
          />
        ) : null}
        {wantFile ? (
          <CaptureButton
            label="Attach file"
            icon={<FileText className="h-4 w-4" />}
            accept="*/*"
            multiple={multiple}
            disabled={disabled}
            onFiles={handleFiles}
          />
        ) : null}
        {busy > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading {busy}…
          </span>
        ) : null}
      </div>

      {short ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">
          At least {need} {need === 1 ? "photo" : "photos"} required —{" "}
          {value.filter((m) => m.kind === "image").length} added.
        </p>
      ) : null}

      {uploadError ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{uploadError}</p> : null}

      {value.length > 0 ? (
        // Horizontally scrollable "recent shots" strip — reviews the whole batch
        // (not a truncated few) so cleaners can scan what they captured.
        <div
          className={cn(
            "flex snap-x gap-2 overflow-x-auto rounded-[var(--e-radius)] pb-1",
            error && "ring-1 ring-[hsl(var(--e-danger))] ring-offset-2"
          )}
        >
          {value.map((m, i) => (
            <div
              key={m.key}
              className="group relative h-24 w-24 shrink-0 snap-start overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]"
            >
              <button
                type="button"
                onClick={() => setLightbox(i)}
                className="block h-full w-full"
                aria-label={m.kind === "video" ? "Play video" : "View photo"}
              >
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.name || "upload"} className="h-full w-full object-cover" />
                ) : m.kind === "video" ? (
                  <>
                    <video
                      src={m.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                      <Play className="h-6 w-6 drop-shadow" fill="currentColor" />
                    </span>
                  </>
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[hsl(var(--e-muted-foreground))]">
                    <FileText className="h-5 w-5" />
                    <span className="line-clamp-2 text-[0.625rem]">{m.name || "file"}</span>
                  </span>
                )}
              </button>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => remove(m.key)}
                  aria-label="Remove"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--e-background)/0.85)] text-[hsl(var(--e-foreground))] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {lightbox != null ? (
        <MediaLightbox
          items={lightboxItems}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

function CaptureButton({
  label,
  icon,
  accept,
  capture,
  multiple,
  disabled,
  onFiles,
}: {
  label: string;
  icon: React.ReactNode;
  accept: string;
  capture?: "environment" | "user";
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null, source: CaptureSource) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted))]",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <input
        type="file"
        accept={accept}
        // capture is a valid attribute on file inputs (camera/mic). React types
        // accept a string here.
        {...(capture ? { capture } : {})}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          // A `capture` input = fresh camera shot (stamped); plain picker = gallery.
          onFiles(e.target.files, capture ? "camera" : "gallery");
          e.currentTarget.value = "";
        }}
      />
      {icon}
      {label}
    </label>
  );
}
