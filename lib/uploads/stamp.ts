"use client";

/**
 * Evidence image stamping — the single source of truth for burning an evidence
 * overlay into every job/QA/maintenance photo captured or uploaded in the app.
 *
 * `stampImage(file, opts)` draws the source image to a canvas (downscaled,
 * EXIF-oriented) and burns in a bottom evidence band: timestamp
 * (Australia/Sydney by default), the capturer's name, GPS lat/lng + accuracy
 * when supplied, the sNeek logo (CORS-safe load with a wordmark fallback), and
 * optionally the field/section label + job/property reference. It returns a new
 * JPEG `File`.
 *
 * Design goals:
 *  - NEVER throw out of the happy path: a bad logo, a missing GPS fix, or a
 *    weird EXIF tag must degrade gracefully, never lose the photo. The only way
 *    it returns the original file unchanged is when the browser has no canvas.
 *  - Fast: downscale first, draw once, encode once with adaptive quality.
 *  - Tasteful but unmistakably an evidence stamp (bodycam-style band).
 *
 * This module is browser-only (uses canvas + Image). Keep it free of React.
 */

export interface StampGps {
  lat: number;
  lng: number;
  /** Radius of confidence in metres, or null/undefined when unknown. */
  accuracy?: number | null;
}

export interface StampOptions {
  /** Capturer's display name (cleaner / QA reviewer). */
  capturerName?: string;
  /** GPS fix for the capture session, reused across shots. */
  gps?: StampGps | null;
  /** IANA timezone for the timestamp. Defaults to Australia/Sydney. */
  timezone?: string;
  /** Company branding logo URL (from /api/public/branding). */
  logoUrl?: string;
  /** Company name — used for the wordmark fallback when the logo can't load. */
  companyName?: string;
  /** Optional field / section label (e.g. "Kitchen · Inside the fridge"). */
  contextLabel?: string;
  /** Optional job / property reference shown small on the band. */
  reference?: string;
  /** Longest edge of the output image in px (downscale target). Default 1600. */
  maxDimension?: number;
  /** Target encoded size in bytes for adaptive JPEG quality. Default 1.5MB. */
  targetBytes?: number;
}

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_TARGET_BYTES = 1.5 * 1024 * 1024;
const MIN_QUALITY = 0.45;
const DEFAULT_TIMEZONE = "Australia/Sydney";

const IMAGE_MIME = /^image\//i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;

/** True when the file is an image we should stamp (not a video / document). */
export function isStampableImage(file: File): boolean {
  if (typeof file?.type === "string" && IMAGE_MIME.test(file.type)) return true;
  if (typeof file?.name === "string" && IMAGE_EXT.test(file.name)) return true;
  return false;
}

/** Australia/Sydney (or supplied tz) "15 Jun 2026, 02:14 pm" timestamp. */
function formatTimestamp(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date());
  } catch {
    try {
      return new Date().toLocaleString("en-AU");
    } catch {
      return new Date().toISOString();
    }
  }
}

function formatGps(gps: StampGps | null | undefined): string | null {
  if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) return null;
  const coords = `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
  const acc = gps.accuracy;
  if (acc != null && Number.isFinite(acc)) {
    const accLabel = acc >= 1000 ? `±${(acc / 1000).toFixed(1)} km` : `±${Math.round(acc)} m`;
    return `${coords}  ${accLabel}`;
  }
  return coords;
}

function loadImageFromUrl(url: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-load-failed"));
    image.src = url;
  });
}

async function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function scaledDimensions(width: number, height: number, maxDimension: number) {
  if (!width || !height) return { width: maxDimension, height: maxDimension };
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Module-level logo cache keyed by URL. The logo is fetched once (same-origin
 * fetch → blob → object URL, which sidesteps the canvas "tainted" CORS trap),
 * decoded to an HTMLImageElement, and reused for every subsequent stamp. A
 * failed load resolves to null (never rejects) so the wordmark fallback kicks
 * in without breaking the stamp.
 */
const logoCache = new Map<string, Promise<HTMLImageElement | null>>();

function getBrandLogo(logoUrl: string | undefined): Promise<HTMLImageElement | null> {
  if (!logoUrl) return Promise.resolve(null);
  const cached = logoCache.get(logoUrl);
  if (cached) return cached;
  const promise = (async (): Promise<HTMLImageElement | null> => {
    // Prefer fetch→blob (works for same-origin and CORS-enabled remotes and
    // yields a non-tainting object URL). Fall back to an anonymous <img> load.
    try {
      const response = await fetch(logoUrl, { cache: "force-cache" });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        try {
          return await loadImageFromUrl(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch {
      // fall through to anonymous img
    }
    try {
      return await loadImageFromUrl(logoUrl, "anonymous");
    } catch {
      return null;
    }
  })();
  logoCache.set(logoUrl, promise);
  return promise;
}

async function encodeAdaptiveJpeg(
  canvas: HTMLCanvasElement,
  baseName: string,
  targetBytes: number
): Promise<File | null> {
  let quality = 0.82;
  let working = canvas;
  let blob: Blob | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    blob = await new Promise<Blob | null>((resolve) =>
      working.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return null;
    if (blob.size <= targetBytes || (quality <= MIN_QUALITY && attempt >= 2)) break;
    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.1);
      continue;
    }
    // Already at min quality and still too big — shrink the canvas.
    const width = Math.max(900, Math.round(working.width * 0.85));
    const height = Math.max(900, Math.round(working.height * 0.85));
    const resized = document.createElement("canvas");
    resized.width = width;
    resized.height = height;
    const ctx = resized.getContext("2d");
    if (!ctx) break;
    ctx.drawImage(working, 0, 0, width, height);
    working = resized;
  }

  if (!blob) return null;
  const stem = baseName.replace(/\.[^.]+$/, "") || "evidence";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

/** Wrap a long line to fit `maxWidth`, returning the (possibly truncated) text. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Burn the evidence overlay onto a copy of `file` and return a new JPEG File.
 * Returns the original file untouched only when the browser lacks canvas
 * support (SSR / very old browsers). Any rendering error throws so callers can
 * decide whether to fall back to the raw file.
 */
export async function stampImage(file: File, opts: StampOptions = {}): Promise<File> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return file;
  }

  const maxDimension = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const targetBytes = opts.targetBytes ?? DEFAULT_TARGET_BYTES;
  const timezone = opts.timezone || DEFAULT_TIMEZONE;

  const source = await loadImageFromFile(file);
  const { width, height } = scaledDimensions(
    source.naturalWidth || source.width,
    source.naturalHeight || source.height,
    maxDimension
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  // Modern browsers (and createImageBitmap upstream) auto-apply EXIF
  // orientation when drawing, so a straight drawImage is correct here. We draw
  // into the scaled canvas in one pass.
  ctx.drawImage(source, 0, 0, width, height);

  // ---- Overlay geometry (scaled to the image) ----
  const scale = canvas.width / 1000;
  const pad = Math.max(12, Math.round(18 * scale));
  const primarySize = Math.max(15, Math.round(26 * scale));
  const secondarySize = Math.max(12, Math.round(20 * scale));
  const lineGap = Math.round(primarySize * 0.45);
  const logoSize = Math.max(28, Math.round(primarySize * 2));
  const gap = Math.max(8, Math.round(primarySize * 0.55));

  const capturer = (opts.capturerName || "Cleaner").trim() || "Cleaner";
  const company = (opts.companyName || "sNeek Property Services").trim() || "sNeek Property Services";
  const timestamp = formatTimestamp(timezone);
  const gpsLine = formatGps(opts.gps);
  const contextLabel = opts.contextLabel?.trim();
  const reference = opts.reference?.trim();

  // Lines on the text block, in render order. Primary = capturer; the rest are
  // secondary detail lines.
  const detailLines: string[] = [timestamp];
  if (gpsLine) detailLines.push(gpsLine);
  if (contextLabel) detailLines.push(contextLabel);
  if (reference) detailLines.push(reference);

  ctx.textBaseline = "top";

  // Measure to size the band. The text column starts after the logo.
  const logo = await getBrandLogo(opts.logoUrl).catch(() => null);
  const hasLogo = Boolean(logo);
  const logoW = hasLogo && logo ? Math.round(logoSize * (logo.naturalWidth / Math.max(1, logo.naturalHeight))) : logoSize;
  const logoColumn = hasLogo ? logoW + gap : 0;
  const textMaxWidth = canvas.width - pad * 2 - logoColumn;

  ctx.font = `700 ${primarySize}px Arial, Helvetica, sans-serif`;
  const capturerText = fitText(ctx, capturer, textMaxWidth);
  ctx.font = `500 ${secondarySize}px Arial, Helvetica, sans-serif`;
  const fittedDetails = detailLines.map((line) => fitText(ctx, line, textMaxWidth));

  const textBlockHeight =
    primarySize + lineGap + fittedDetails.length * (secondarySize + lineGap) - lineGap;
  const wordmarkHeight = hasLogo ? 0 : primarySize + lineGap; // wordmark sits where logo would
  const blockHeight = Math.max(textBlockHeight + wordmarkHeight, logoSize);
  const bandHeight = blockHeight + pad * 2;
  const bandY = Math.max(0, canvas.height - bandHeight);

  // ---- Backdrop: gradient for legibility over any image ----
  const gradient = ctx.createLinearGradient(0, bandY, 0, canvas.height);
  gradient.addColorStop(0, "rgba(8, 11, 20, 0)");
  gradient.addColorStop(0.18, "rgba(8, 11, 20, 0.55)");
  gradient.addColorStop(1, "rgba(8, 11, 20, 0.82)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, bandY, canvas.width, bandHeight);

  // Thin accent rule along the top of the band.
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(0, bandY, canvas.width, Math.max(1, Math.round(2 * scale)));

  // ---- Logo (or wordmark fallback) ----
  let textX = pad;
  const contentTop = bandY + pad;
  if (hasLogo && logo) {
    const logoY = Math.round(contentTop + Math.max(0, (blockHeight - logoSize) / 2));
    try {
      ctx.drawImage(logo, pad, logoY, logoW, logoSize);
    } catch {
      // Tainted/oversized logo — fall back to wordmark below.
    }
    textX = pad + logoW + gap;
  }

  // ---- Text ----
  let cursorY = contentTop;
  if (!hasLogo) {
    // Wordmark fallback as the top line of the column.
    ctx.font = `800 ${primarySize}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("sNeek", textX, cursorY);
    const markWidth = ctx.measureText("sNeek").width;
    ctx.font = `500 ${secondarySize}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(" Property Services", textX + markWidth, cursorY + (primarySize - secondarySize));
    cursorY += primarySize + lineGap;
  }

  // Primary line: capturer name (bold, white).
  ctx.font = `700 ${primarySize}px Arial, Helvetica, sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = Math.max(2, Math.round(3 * scale));
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(capturerText, textX, cursorY);
  cursorY += primarySize + lineGap;

  // Secondary detail lines.
  ctx.font = `500 ${secondarySize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  for (const line of fittedDetails) {
    ctx.fillText(line, textX, cursorY);
    cursorY += secondarySize + lineGap;
  }
  ctx.shadowBlur = 0;

  // Company name aligned to the bottom-right of the band as a subtle mark.
  ctx.font = `600 ${secondarySize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  const companyText = fitText(ctx, company, canvas.width - pad * 2);
  const companyWidth = ctx.measureText(companyText).width;
  ctx.fillText(companyText, canvas.width - pad - companyWidth, canvas.height - pad - secondarySize);

  const encoded = await encodeAdaptiveJpeg(canvas, file.name, targetBytes);
  return encoded ?? file;
}
