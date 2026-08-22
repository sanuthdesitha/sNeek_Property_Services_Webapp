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
  Ban,
  Check,
  ListChecks,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { prepareUploadFile } from "@/lib/uploads/compress";
import { isStampableImage, type StampGps, type StampOptions } from "@/lib/uploads/stamp";
import { getAccuratePosition } from "@/lib/geo/get-position";
import { uploadMultipart } from "@/lib/uploads/multipart-client";

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

/**
 * A failure that could not possibly succeed on a retry — the server rejected
 * the file itself (too large, wrong type, not signed in).
 */
class PermanentUploadError extends Error {}

/** Above this, an automatic retry costs more than it saves on mobile data. */
const AUTO_RETRY_MAX_BYTES = 25 * 1024 * 1024;

/**
 * One upload, over XHR rather than fetch.
 *
 * fetch cannot report UPLOAD progress — only download. A cleaner sending a
 * 100MB clip therefore watched a spinner that never moved, decided the app had
 * hung, and killed it partway through. XHR exposes upload.onprogress, so the
 * bar reflects bytes actually leaving the phone.
 */
/**
 * The large-file path: presigned multipart, straight to the bucket.
 *
 * Reuses lib/uploads/multipart-client, which v1 already relies on, rather
 * than growing a second implementation — the two would drift, and the one
 * used by the portal nobody tests on a 4G phone is the one that would rot.
 */
async function uploadLargeFile(
  file: File,
  folder: string,
  onBytes?: (sent: number, total: number) => void,
  signal?: AbortSignal
): Promise<CapturedMedia> {
  try {
    const { url, key } = await uploadMultipart(
      file,
      file.name,
      file.type || "application/octet-stream",
      (progress) => onBytes?.(progress.bytesUploaded, progress.totalBytes),
      signal,
      folder
    );
    return { key, url, name: file.name, kind: kindForFile(file) };
  } catch (err: any) {
    // An aborted upload is a decision, not a failure — it must not be offered
    // for automatic retry alongside genuine errors.
    if (signal?.aborted) throw new PermanentUploadError("Upload cancelled");
    throw new Error(err?.message || "Upload failed");
  }
}

/**
 * Above this, the file goes straight to the bucket in parts instead of
 * through our own server.
 *
 * `/api/uploads/direct` parses the request with `req.formData()`, which
 * buffers the WHOLE body into memory before the handler can stream it
 * anywhere. The web container runs on a 512MB heap and the video limit is
 * 300MB, so a long arrival walkthrough could not fit through that path at all
 * — it died as an out-of-memory or a dead socket rather than as an error
 * anyone could read.
 *
 * v1's upload-dropzone has switched to multipart above 10MB for a long time.
 * This component was written against the direct endpoint alone, so the v2
 * cleaner portal — the one cleaners actually use — silently lost the only
 * path that could carry a big video.
 */
const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;

function uploadOne(
  file: File,
  folder: string,
  onBytes?: (sent: number, total: number) => void,
  signal?: AbortSignal
): Promise<CapturedMedia> {
  // Big files bypass our server entirely: presigned parts, straight to S3.
  // Progress and cancellation both survive, so the UI is unchanged.
  if (file.size > MULTIPART_THRESHOLD_BYTES) {
    return uploadLargeFile(file, folder, onBytes, signal);
  }
  return new Promise((resolve, reject) => {
    // Cancel has to reach the socket, not just the UI. Hiding the progress bar
    // while the phone keeps pushing a 90MB clip spends exactly the mobile data
    // the cancel button exists to save.
    if (signal?.aborted) {
      reject(new PermanentUploadError("Upload cancelled"));
      return;
    }

    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/direct");

    const onAbortSignal = () => xhr.abort();
    signal?.addEventListener("abort", onAbortSignal);
    // Fires after load, error, abort and timeout alike — anything narrower
    // leaks a listener per cancelled file onto a long-lived controller.
    xhr.onloadend = () => signal?.removeEventListener("abort", onAbortSignal);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes?.(event.loaded, event.total);
    };

    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.key) {
        resolve({
          key: body.key,
          url: body.url,
          kind: kindForFile(file),
          name: file.name,
        });
        return;
      }
      const message = body?.error || `Upload failed (${xhr.status})`;
      // 4xx is the server saying no; retrying gets the same answer slower.
      if (xhr.status >= 400 && xhr.status < 500) {
        reject(new PermanentUploadError(message));
      } else {
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Network dropped during upload"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new PermanentUploadError("Upload cancelled"));
    xhr.send(fd);
  });
}

/**
 * One upload with a single retry, for files small enough that a retry is
 * cheaper than asking a person to try again.
 *
 * A big video is deliberately NOT auto-retried: re-sending 100MB over mobile
 * data to fix a blip that may well repeat is worse than surfacing it and
 * letting the cleaner decide. It lands in the failed list with a Retry button.
 */
async function uploadWithRetry(
  file: File,
  folder: string,
  onBytes?: (sent: number, total: number) => void,
  signal?: AbortSignal
): Promise<CapturedMedia> {
  try {
    return await uploadOne(file, folder, onBytes, signal);
  } catch (err) {
    // A cancelled upload surfaces as PermanentUploadError, so the retry below
    // is skipped without needing its own abort check.
    if (err instanceof PermanentUploadError) throw err;
    if (file.size > AUTO_RETRY_MAX_BYTES) throw err;
    await new Promise((resolve) => setTimeout(resolve, 700));
    return uploadOne(file, folder, onBytes, signal);
  }
}

/**
 * How many uploads run at once.
 *
 * Was unbounded: thirty photos opened thirty simultaneous POSTs and thirty
 * canvas compressions on a phone. Browsers run about six connections per host,
 * so the rest queued at the socket layer where a flaky mobile connection killed
 * them silently.
 *
 * Videos get a lane of their own. Three 80MB uploads sharing one phone's uplink
 * each take three times as long and all three stay exposed to the same dropout,
 * so a video batch runs one at a time and finishes sooner in practice.
 */
const PHOTO_CONCURRENCY = 4;
const VIDEO_CONCURRENCY = 1;
const VIDEO_BYTES_THRESHOLD = 8 * 1024 * 1024;

function isHeavyUpload(file: File): boolean {
  return file.type.toLowerCase().startsWith("video/") || file.size > VIDEO_BYTES_THRESHOLD;
}

export interface UploadFailure {
  name: string;
  reason: string;
  /** Kept so the caller can retry exactly this file without re-picking it. */
  file: File;
}

export interface UploadProgress {
  name: string;
  /** 0-100, or null before the first progress event. */
  percent: number | null;
}

/**
 * Shared stamp → compress → upload pipeline. Reused by MediaCapture and the
 * guided capture surface so evidence stamping is never bypassed.
 *
 * Bounded pool, but each result is written to its ORIGINAL index, so the
 * gallery ends up in the order the cleaner picked the files rather than the
 * order the network happened to finish them.
 *
 * Never rejects: it reports which files failed, why, and hands back the File
 * itself so a retry does not mean re-picking thirty photos to find the two
 * that did not make it.
 */
export async function prepareAndUploadFiles(
  files: File[],
  opts: {
    folder: string;
    stamp?: StampOptions | null;
    source: CaptureSource;
    /** Fires as each file settles. */
    onProgress?: (done: number, total: number) => void;
    /** Fires as bytes move, so a big video shows movement rather than a spinner. */
    onFileProgress?: (inFlight: UploadProgress[]) => void;
    /**
     * Abort the batch. Files already uploaded stay in `results` — a cancel that
     * threw away thirty finished photos to stop the thirty-first would be worse
     * than the wait it saved.
     */
    signal?: AbortSignal;
  }
): Promise<{ results: CapturedMedia[]; failed: UploadFailure[]; failedCount: number }> {
  const slots: Array<CapturedMedia | null> = new Array(files.length).fill(null);
  const failed: UploadFailure[] = [];
  const inFlight = new Map<number, UploadProgress>();
  let done = 0;

  function publish() {
    opts.onFileProgress?.(Array.from(inFlight.values()));
  }

  // Heavy files run in their own single-file lane; photos run several at a
  // time. Splitting them means a 90MB video never starves a batch of photos,
  // and the photos never fragment the video's bandwidth.
  const heavy: number[] = [];
  const light: number[] = [];
  files.forEach((file, index) => (isHeavyUpload(file) ? heavy : light).push(index));

  async function runLane(queue: number[], width: number) {
    let next = 0;
    async function worker() {
      // Queued files are dropped on cancel rather than started and killed:
      // stamping a photo burns CPU on the phone before a single byte moves.
      while (next < queue.length && !opts.signal?.aborted) {
        const index = queue[next++];
        const file = files[index];
        inFlight.set(index, { name: file.name, percent: null });
        publish();
        try {
          const prepared = await prepareCapturedFile(file, opts.source, opts.stamp);
          slots[index] = await uploadWithRetry(
            prepared,
            opts.folder,
            (sent, total) => {
              inFlight.set(index, {
                name: file.name,
                percent: total > 0 ? Math.round((sent / total) * 100) : null,
              });
              publish();
            },
            opts.signal
          );
        } catch (err: any) {
          // A file the cleaner cancelled is not a file that failed. Putting it
          // in the red retry box invites them to re-send what they just stopped.
          if (!opts.signal?.aborted) {
            failed.push({
              name: file.name || `File ${index + 1}`,
              reason: err?.message || "Upload failed",
              file,
            });
          }
        } finally {
          inFlight.delete(index);
          done += 1;
          opts.onProgress?.(done, files.length);
          publish();
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(width, queue.length) }, () => worker()));
  }

  await Promise.all([runLane(light, PHOTO_CONCURRENCY), runLane(heavy, VIDEO_CONCURRENCY)]);

  return {
    results: slots.filter((m): m is CapturedMedia => m !== null),
    failed,
    failedCount: failed.length,
  };
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
  // Counting up beats a spinner: on a slow connection a lump spinner is
  // indistinguishable from a hang, and cleaners kill the tab.
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  // Kept until the cleaner clears or retries them. A message that vanishes is
  // no use to someone who looked away while thirty photos uploaded.
  const [failures, setFailures] = React.useState<UploadFailure[]>([]);
  const [inFlight, setInFlight] = React.useState<UploadProgress[]>([]);
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  // Cancelling is not an error, so it must not land in the red error line —
  // a cleaner who deliberately stopped an upload should not be told off.
  const [notice, setNotice] = React.useState<string | null>(null);
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const abortRef = React.useRef<AbortController | null>(null);

  // Leaving the screen must stop the radio. Without this a cleaner who backs
  // out mid-batch keeps a video uploading into a component nobody is watching.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const runUpload = React.useCallback(
    async (list: File[], source: CaptureSource) => {
      if (list.length === 0) return;
      setUploadError(null);
      setNotice(null);
      setBusy((n) => n + list.length);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { results, failed } = await prepareAndUploadFiles(list, {
          folder,
          stamp,
          source,
          signal: controller.signal,
          onProgress: (uploadDone, total) =>
            setProgress(total > 1 ? { done: uploadDone, total } : null),
          onFileProgress: setInFlight,
        });
        // Replaced rather than appended: this list IS the files that just
        // ran, so anything previously failed and now retried disappears.
        setFailures(failed);
        if (results.length > 0) {
          onChange(multiple ? [...value, ...results] : results.slice(-1));
        }
        if (controller.signal.aborted) {
          setNotice(
            results.length > 0
              ? `Upload cancelled — ${results.length} already finished and ${
                  results.length === 1 ? "was" : "were"
                } kept.`
              : "Upload cancelled."
          );
        }
      } catch (e: any) {
        setUploadError(e?.message || "Upload failed");
      } finally {
        // Only clear the ref if a later batch has not already claimed it,
        // otherwise Cancel silently stops aborting the run that is live.
        if (abortRef.current === controller) abortRef.current = null;
        setBusy((n) => Math.max(0, n - list.length));
        setProgress(null);
        setInFlight([]);
      }
    },
    [folder, multiple, onChange, value, stamp]
  );

  const cancelUpload = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleFiles = React.useCallback(
    async (files: FileList | null, source: CaptureSource) => {
      if (!files || files.length === 0) return;
      await runUpload(Array.from(files), source);
    },
    [runUpload]
  );

  // Retry sends the ORIGINAL File objects. The cleaner does not re-pick, and
  // on a phone they often cannot: the camera-roll entry for a photo taken a
  // minute ago is not always easy to find again.
  const retryFailed = React.useCallback(async () => {
    const files = failures.map((f) => f.file);
    if (files.length === 0) return;
    // Re-stamping is idempotent, and "gallery" is right: the file is no
    // longer coming straight off the camera.
    await runUpload(files, "gallery");
  }, [failures, runUpload]);

  /**
   * Removal is list-only. There is no cleaner-facing delete endpoint —
   * `deleteObject` in lib/s3.ts is server-side and reached only when an admin
   * deletes the whole submission — so the S3 object stays until then. That is
   * deliberate: the alternative is handing every cleaner a way to erase
   * evidence of a job from the bucket.
   */
  const removeKeys = React.useCallback(
    (keys: Set<string>) => {
      if (keys.size === 0) return;
      onChange(value.filter((m) => !keys.has(m.key)));
      setSelected((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.delete(key));
        return next;
      });
      // The index the lightbox is holding refers to a list that no longer
      // exists, so it would open on the wrong shot.
      setLightbox(null);
    },
    [onChange, value]
  );

  const toggleSelected = React.useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const exitSelecting = React.useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // Selection mode with nothing left to select hides its own exit, so the next
  // batch of photos would land straight into a mode the cleaner never chose.
  React.useEffect(() => {
    if (value.length === 0 && selecting) exitSelecting();
  }, [value.length, selecting, exitSelecting]);

  const wantPhoto = mode === "photo" || mode === "both";
  const wantVideo = mode === "video" || mode === "both";
  const wantFile = mode === "file";
  const need = minPhotos ?? 0;
  const short = need > 0 && value.filter((m) => m.kind === "image").length < need;
  const selectedCount = value.filter((m) => selected.has(m.key)).length;
  const allSelected = value.length > 0 && selectedCount === value.length;

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
            <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
            {progress ? `Uploading ${progress.done} of ${progress.total}…` : `Uploading ${busy}…`}
          </span>
        ) : null}
        {busy > 0 ? (
          <button
            type="button"
            onClick={cancelUpload}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-danger))] px-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))] transition-colors duration-[160ms] hover:bg-[hsl(var(--e-danger)/0.08)]"
          >
            <Ban className="h-4 w-4" />
            Cancel
          </button>
        ) : null}
      </div>

      {short ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">
          At least {need} {need === 1 ? "photo" : "photos"} required —{" "}
          {value.filter((m) => m.kind === "image").length} added.
        </p>
      ) : null}

      {uploadError ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{uploadError}</p> : null}

      {notice ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{notice}</p>
      ) : null}

      {/* Bytes actually leaving the phone. A big video used to show nothing
          but a spinner, so cleaners assumed a hang and killed the app. */}
      {inFlight.length > 0 ? (
        <ul className="space-y-1">
          {inFlight.map((item) => (
            <li
              key={item.name}
              className="flex items-center gap-2 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="h-1 w-20 overflow-hidden rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))]">
                <span
                  className="block h-full bg-[hsl(var(--e-gold))] transition-[width]"
                  style={{ width: `${item.percent ?? 0}%` }}
                />
              </span>
              <span className="e-tnum w-9 text-right">
                {item.percent === null ? "…" : `${item.percent}%`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The failed list persists until retried or dismissed. Retry re-sends
          the original File objects, so nobody has to hunt the camera roll for
          the two photos out of thirty that did not make it. */}
      {failures.length > 0 ? (
        <div className="space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.06)] p-2.5">
          <p className="text-[0.75rem] font-medium text-[hsl(var(--e-danger))]">
            {failures.length} {failures.length === 1 ? "file" : "files"} did not upload
          </p>
          <ul className="space-y-1">
            {failures.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))]"
              >
                <span className="font-medium">{f.name}</span>
                <span className="text-[hsl(var(--e-text-faint))]"> — {f.reason}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy > 0}
              onClick={() => void retryFailed()}
              className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-danger))] px-2 py-1 text-[0.6875rem] font-medium text-[hsl(var(--e-danger))] disabled:opacity-50"
            >
              Retry {failures.length === 1 ? "it" : "them"}
            </button>
            <button
              type="button"
              onClick={() => setFailures([])}
              className="text-[0.6875rem] text-[hsl(var(--e-text-faint))] underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Bulk removal lives above the strip, not inside it. Deleting thirty
          mis-shot photos one X at a time on a phone is the reason cleaners
          submitted jobs with the wrong evidence attached. */}
      {value.length > 0 && !disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted))]"
          >
            <ListChecks className="h-3.5 w-3.5" />
            {selecting ? "Done" : "Select"}
          </button>
          {selecting ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(value.map((m) => m.key)))
                }
                className="text-[0.75rem] text-[hsl(var(--e-text-faint))] underline"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={() => removeKeys(new Set(selected))}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-danger))] px-2.5 text-[0.75rem] font-[550] text-[hsl(var(--e-danger))] transition-colors duration-[160ms] hover:bg-[hsl(var(--e-danger)/0.08)] disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove {selectedCount > 0 ? `${selectedCount} ` : ""}selected
              </button>
            </>
          ) : null}
        </div>
      ) : null}

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
              className={cn(
                "group relative h-24 w-24 shrink-0 snap-start overflow-hidden rounded-[var(--e-radius)] border bg-[hsl(var(--e-surface-sunken))]",
                selecting && selected.has(m.key)
                  ? "border-[hsl(var(--e-gold))] ring-2 ring-[hsl(var(--e-gold))]"
                  : "border-[hsl(var(--e-border))]"
              )}
            >
              <button
                type="button"
                onClick={() => (selecting ? toggleSelected(m.key) : setLightbox(i))}
                className="block h-full w-full"
                aria-pressed={selecting ? selected.has(m.key) : undefined}
                aria-label={
                  selecting
                    ? `${selected.has(m.key) ? "Deselect" : "Select"} ${m.name || "item"}`
                    : m.kind === "video"
                      ? "Play video"
                      : "View photo"
                }
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
              {selecting ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-[var(--e-radius-sm)] border",
                    selected.has(m.key)
                      ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]"
                      : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-background)/0.85)]"
                  )}
                >
                  {selected.has(m.key) ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
              ) : null}
              {/* Always visible, never hover-revealed: a phone has no hover, and
                  this control being invisible on touch is why cleaners could
                  not drop a bad shot without wiping the whole field. */}
              {!disabled && !selecting ? (
                <button
                  type="button"
                  onClick={() => removeKeys(new Set([m.key]))}
                  aria-label={`Remove ${m.name || "item"}`}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--e-background)/0.85)] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
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
