"use client";

/**
 * Evidence image stamping — the single source of truth for burning an evidence
 * overlay into every job/QA/maintenance photo captured or uploaded in the app.
 *
 * `stampImage(file, opts)` draws the source image to a canvas (downscaled,
 * EXIF-oriented) and burns in a "Timemark"-style evidence overlay:
 *
 *   - TOP-LEFT  : a small rounded translucent tag — "Before" / "After" /
 *                 "Damage" (driven by `opts.tag`).
 *   - TOP-RIGHT : the sNeek logo (CORS-safe load, wordmark fallback).
 *   - BOTTOM-LEFT block (on a soft scrim): a LARGE time (HH:mm), then the date
 *                 (DD/MM/YYYY), the weekday (Sat), and a full street ADDRESS
 *                 line. Falls back to GPS coordinates only when no address is
 *                 supplied.
 *
 * It returns a new JPEG `File`.
 *
 * Design goals:
 *  - NEVER throw out of the happy path: a bad logo, a missing GPS fix, or a
 *    weird EXIF tag must degrade gracefully, never lose the photo. The only way
 *    it returns the original file unchanged is when the browser has no canvas.
 *  - Fast: downscale first, draw once, encode once with adaptive quality.
 *  - Tasteful but unmistakably an evidence stamp.
 *  - Timestamp format is configurable (date/time presets + weekday toggle),
 *    defaulting to the reference style (DD/MM/YYYY · HH:mm · weekday).
 *
 * This module is browser-only (uses canvas + Image). Keep it free of React.
 */

export interface StampGps {
  lat: number;
  lng: number;
  /** Radius of confidence in metres, or null/undefined when unknown. */
  accuracy?: number | null;
}

/** Supported date format presets for the stamp (see formatDate). */
export type StampDateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";

/** Supported time format presets for the stamp (24h or 12h). */
export type StampTimeFormat = "HH:mm" | "hh:mm a";

export interface StampFormat {
  /** Date line format. Default "DD/MM/YYYY". */
  dateFormat?: StampDateFormat | string;
  /** Time line format. Default "HH:mm". */
  timeFormat?: StampTimeFormat | string;
  /** Show the weekday (e.g. "Sat") under the date. Default true. */
  showWeekday?: boolean;
}

export interface StampOptions {
  /** Capturer's display name (cleaner / QA reviewer). */
  capturerName?: string;
  /**
   * Context tag rendered in the top-left rounded chip. "before" / "after" /
   * "damage" are styled; any other string is shown verbatim (title-cased).
   */
  tag?: "before" | "after" | "damage" | string;
  /**
   * Full street address shown on the bottom block (street, suburb, state,
   * postcode). Preferred over GPS — coordinates are only drawn when this is
   * absent.
   */
  address?: string;
  /** GPS fix for the capture session, reused across shots. */
  gps?: StampGps | null;
  /** IANA timezone for the timestamp. Defaults to Australia/Sydney. */
  timezone?: string;
  /** Date / time format overrides (falls back to the reference style). */
  dateFormat?: StampDateFormat | string;
  timeFormat?: StampTimeFormat | string;
  showWeekday?: boolean;
  /** Company branding logo URL (from /api/public/branding). */
  logoUrl?: string;
  /** Company name — used for the wordmark fallback when the logo can't load. */
  companyName?: string;
  /** Optional field / section label (e.g. "Kitchen · Inside the fridge"). */
  contextLabel?: string;
  /** Optional job / property reference shown small on the block. */
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
const DEFAULT_DATE_FORMAT = "DD/MM/YYYY";
const DEFAULT_TIME_FORMAT = "HH:mm";

const IMAGE_MIME = /^image\//i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;

/** True when the file is an image we should stamp (not a video / document). */
export function isStampableImage(file: File): boolean {
  if (typeof file?.type === "string" && IMAGE_MIME.test(file.type)) return true;
  if (typeof file?.name === "string" && IMAGE_EXT.test(file.name)) return true;
  return false;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Resolve the wall-clock parts (year/month/day/hour/minute/weekday) for `date`
 * in the given IANA timezone using Intl, with a graceful local-time fallback.
 */
function zonedParts(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    let hour = get("hour");
    // Intl can emit "24" for midnight under hour12:false — normalise to "00".
    if (hour === "24") hour = "00";
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour,
      minute: get("minute"),
      weekday: get("weekday"),
    };
  } catch {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return {
      year: String(date.getFullYear()),
      month: pad(date.getMonth() + 1),
      day: pad(date.getDate()),
      hour: pad(date.getHours()),
      minute: pad(date.getMinutes()),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()],
    };
  }
}

/** Format the time line from preset (HH:mm / hh:mm a). */
function formatTime(p: { hour: string; minute: string }, timeFormat: string): string {
  const fmt = (timeFormat || DEFAULT_TIME_FORMAT).trim();
  // 12-hour when the preset uses lowercase "h" (hh) or an am/pm token "a".
  const is12h = fmt.includes("hh") || /\ba\b/.test(fmt) || / a$/.test(fmt);
  if (is12h) {
    const h24 = Number(p.hour);
    const period = h24 >= 12 ? "pm" : "am";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${p.minute} ${period}`;
  }
  return `${p.hour}:${p.minute}`;
}

/** Format the date line from preset. */
function formatDate(
  p: { year: string; month: string; day: string },
  dateFormat: string
): string {
  const fmt = (dateFormat || DEFAULT_DATE_FORMAT).trim();
  const monthName = SHORT_MONTHS[Math.max(0, Math.min(11, Number(p.month) - 1))] ?? p.month;
  switch (fmt) {
    case "MM/DD/YYYY":
      return `${p.month}/${p.day}/${p.year}`;
    case "YYYY-MM-DD":
      return `${p.year}-${p.month}-${p.day}`;
    case "DD MMM YYYY":
      return `${p.day} ${monthName} ${p.year}`;
    case "DD/MM/YYYY":
    default:
      return `${p.day}/${p.month}/${p.year}`;
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

/** Map a tag key to its display label + accent colour. */
function resolveTag(tag: string | undefined): { label: string; bg: string } | null {
  const raw = (tag ?? "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (key === "before") return { label: "Before", bg: "rgba(37, 99, 235, 0.85)" }; // blue
  if (key === "after") return { label: "After", bg: "rgba(22, 163, 74, 0.85)" }; // green
  if (key === "damage") return { label: "Damage", bg: "rgba(220, 38, 38, 0.88)" }; // red
  // Unknown tag → neutral chip, title-cased.
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { label, bg: "rgba(15, 23, 42, 0.78)" };
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

/** Draw a filled rounded rectangle (path only; caller sets fillStyle). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
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
  // orientation when drawing, so a straight drawImage is correct here.
  ctx.drawImage(source, 0, 0, width, height);

  // ---- Geometry, scaled to the image ----
  const scale = canvas.width / 1000;
  const pad = Math.max(14, Math.round(22 * scale));
  const timeSize = Math.max(34, Math.round(58 * scale)); // big HH:mm
  const dateSize = Math.max(15, Math.round(24 * scale));
  const metaSize = Math.max(13, Math.round(20 * scale)); // address / reference
  const tagSize = Math.max(13, Math.round(21 * scale)); // top-left chip text
  const lineGap = Math.round(dateSize * 0.32);

  // ---- Resolve content ----
  const parts = zonedParts(new Date(), timezone);
  const timeText = formatTime(parts, opts.timeFormat ?? DEFAULT_TIME_FORMAT);
  const dateText = formatDate(parts, opts.dateFormat ?? DEFAULT_DATE_FORMAT);
  const showWeekday = opts.showWeekday !== false;
  const weekdayText = showWeekday ? parts.weekday : "";
  const company = (opts.companyName || "sNeek Property Services").trim() || "sNeek Property Services";

  const address = opts.address?.trim();
  const gpsLine = formatGps(opts.gps);
  // Address preferred; GPS only as the fallback locator.
  const locationLine = address || gpsLine || "";

  const reference = opts.reference?.trim();
  const contextLabel = opts.contextLabel?.trim();
  const capturer = opts.capturerName?.trim();

  const tag = resolveTag(opts.tag);

  ctx.textBaseline = "top";

  // =====================================================================
  // TOP-LEFT: rounded translucent context tag (Before / After / Damage)
  // =====================================================================
  if (tag) {
    ctx.font = `700 ${tagSize}px Arial, Helvetica, sans-serif`;
    const labelWidth = ctx.measureText(tag.label).width;
    const chipPadX = Math.round(tagSize * 0.7);
    const chipPadY = Math.round(tagSize * 0.42);
    const chipW = labelWidth + chipPadX * 2;
    const chipH = tagSize + chipPadY * 2;
    const chipX = pad;
    const chipY = pad;
    ctx.fillStyle = tag.bg;
    roundRectPath(ctx, chipX, chipY, chipW, chipH, Math.round(chipH * 0.32));
    ctx.fill();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = Math.max(2, Math.round(3 * scale));
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(tag.label, chipX + chipPadX, chipY + chipPadY);
    ctx.shadowBlur = 0;
  }

  // =====================================================================
  // TOP-RIGHT: sNeek logo (or wordmark fallback)
  // =====================================================================
  const logo = await getBrandLogo(opts.logoUrl).catch(() => null);
  const logoTargetH = Math.max(30, Math.round(timeSize * 0.62));
  if (logo) {
    const ratio = logo.naturalWidth / Math.max(1, logo.naturalHeight);
    const logoW = Math.round(logoTargetH * ratio);
    const logoX = canvas.width - pad - logoW;
    const logoY = pad;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = Math.max(2, Math.round(4 * scale));
    try {
      ctx.drawImage(logo, logoX, logoY, logoW, logoTargetH);
    } catch {
      // Tainted/oversized logo — fall back to wordmark below.
      ctx.shadowBlur = 0;
      drawWordmark();
    }
    ctx.shadowBlur = 0;
  } else {
    drawWordmark();
  }

  function drawWordmark() {
    if (!ctx) return;
    const markSize = Math.max(20, Math.round(timeSize * 0.5));
    ctx.font = `800 ${markSize}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "top";
    const markWidth = ctx.measureText("sNeek").width;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.max(2, Math.round(4 * scale));
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("sNeek", canvas.width - pad - markWidth, pad);
    ctx.shadowBlur = 0;
  }

  // =====================================================================
  // BOTTOM-LEFT block: big time, date, weekday, address line
  // =====================================================================
  const blockMaxWidth = canvas.width - pad * 2;

  ctx.font = `500 ${metaSize}px Arial, Helvetica, sans-serif`;
  const fittedLocation = locationLine ? fitText(ctx, locationLine, blockMaxWidth) : "";
  const fittedReference = reference ? fitText(ctx, reference, blockMaxWidth) : "";
  const fittedContext = contextLabel ? fitText(ctx, contextLabel, blockMaxWidth) : "";
  const fittedCapturer = capturer ? fitText(ctx, capturer, blockMaxWidth) : "";

  // Compute block height: time + (date·weekday) + each meta line.
  const metaLines = [fittedLocation, fittedReference, fittedContext, fittedCapturer].filter(Boolean);
  const dateRowHeight = dateSize;
  let blockHeight = timeSize + lineGap + dateRowHeight;
  for (const _ of metaLines) blockHeight += lineGap + metaSize;

  const scrimHeight = blockHeight + pad * 2.2;
  const scrimY = Math.max(0, canvas.height - scrimHeight);

  // Soft bottom scrim for legibility on any photo.
  const gradient = ctx.createLinearGradient(0, scrimY, 0, canvas.height);
  gradient.addColorStop(0, "rgba(8, 11, 20, 0)");
  gradient.addColorStop(0.35, "rgba(8, 11, 20, 0.45)");
  gradient.addColorStop(1, "rgba(8, 11, 20, 0.8)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, scrimY, canvas.width, scrimHeight);

  let cursorY = canvas.height - pad - blockHeight;
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = Math.max(2, Math.round(4 * scale));

  // Big time.
  ctx.font = `800 ${timeSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(timeText, pad, cursorY);
  cursorY += timeSize + lineGap;

  // Date + weekday on one row (date bold, weekday lighter).
  ctx.font = `700 ${dateSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(dateText, pad, cursorY);
  if (weekdayText) {
    const dateWidth = ctx.measureText(dateText).width;
    const sep = "  ·  ";
    ctx.font = `500 ${dateSize}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillText(`${sep}${weekdayText}`, pad + dateWidth, cursorY);
  }
  cursorY += dateRowHeight;

  // Meta lines (address first → it's the headline locator).
  ctx.font = `500 ${metaSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  for (const line of metaLines) {
    cursorY += lineGap;
    ctx.fillText(line, pad, cursorY);
    cursorY += metaSize;
  }
  ctx.shadowBlur = 0;

  // Company mark, subtle, bottom-right.
  ctx.font = `600 ${metaSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const companyText = fitText(ctx, company, canvas.width - pad * 2);
  const companyWidth = ctx.measureText(companyText).width;
  ctx.fillText(companyText, canvas.width - pad - companyWidth, canvas.height - pad - metaSize);

  const encoded = await encodeAdaptiveJpeg(canvas, file.name, targetBytes);
  return encoded ?? file;
}
