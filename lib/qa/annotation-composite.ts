import { randomUUID } from "crypto";
import sharp from "sharp";
import { s3 } from "@/lib/s3";

/**
 * Flattening QA markup onto the photo it annotates.
 *
 * `components/shared/image-annotator.tsx` deliberately exports a **transparent
 * overlay PNG** — the marks only, with no photo underneath. That is a CORS
 * safety measure (drawing a remote image onto the canvas would taint it and
 * make `toBlob` throw), and it means every consumer is responsible for putting
 * the two layers back together.
 *
 * Most of them didn't. The cleaner feed dropped the overlay key entirely, the
 * admin issues workspaces rendered the bare overlay (marks floating on
 * transparency), and the PDF pipeline re-encodes every image to JPEG — which
 * has no alpha channel, so a transparent overlay flattens to a solid black
 * tile that completely hides the photo beneath it.
 *
 * Compositing once, server-side, at the moment the annotation is saved fixes
 * all three at the same time: everything downstream then handles one ordinary
 * opaque JPEG with no layering rules to get wrong.
 */

async function getObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    const res = await s3.getObject({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }).promise();
    const body: any = res.Body;
    if (!body) return null;
    return Buffer.isBuffer(body) ? body : Buffer.from(body);
  } catch {
    return null;
  }
}

/**
 * Flatten a QA markup overlay onto its photo into a single annotated image.
 *
 * Returns the new S3 key, or **null on any failure** — every caller must fall
 * back to the original photo rather than showing the cleaner nothing. A missing
 * annotation is a much smaller problem than a missing photo.
 *
 * `folder` lets callers keep provenance readable in the bucket
 * (`qa-reclean-guidance/…` for rework guidance, `qa-annotations/flat/…` for
 * issue evidence).
 */
export async function compositeAnnotated(
  originalKey: string,
  overlayKey: string,
  ownerId: string,
  folder = "qa-annotations/flat"
): Promise<string | null> {
  try {
    const [orig, overlay] = await Promise.all([
      getObjectBuffer(originalKey),
      getObjectBuffer(overlayKey),
    ]);
    if (!orig || !overlay) return null;
    // `.rotate()` applies the EXIF orientation before we read dimensions —
    // without it a portrait phone photo composites against landscape metadata
    // and the marks land rotated 90° off the thing they point at.
    const meta = await sharp(orig).rotate().metadata();
    const w = meta.width;
    const h = meta.height;
    if (!w || !h) return null;
    const overlayResized = await sharp(overlay).resize(w, h, { fit: "fill" }).png().toBuffer();
    const out = await sharp(orig)
      .rotate()
      .composite([{ input: overlayResized }])
      .jpeg({ quality: 85 })
      .toBuffer();
    const key = `${folder}/${ownerId}/${randomUUID()}.jpg`;
    await s3
      .putObject({ Bucket: process.env.S3_BUCKET_NAME!, Key: key, Body: out, ContentType: "image/jpeg" })
      .promise();
    return key;
  } catch {
    return null;
  }
}

/** One QA evidence photo as stored on `QaIssue.qaPhotoKeys`. */
export interface QaPhotoRef {
  /** The original, un-marked photo. */
  key: string;
  /** Transparent overlay PNG carrying only the marks. Never display alone. */
  annotatedKey?: string | null;
  /** Original + overlay flattened into one opaque image. Prefer this. */
  flatKey?: string | null;
  comment?: string | null;
}

/** Coerce arbitrary stored JSON into QaPhotoRef[]. Tolerates the legacy shapes:
 *  a bare string key, or `{key, annotatedKey}` written before flattening. */
export function normalizeQaPhotoRefs(input: unknown): QaPhotoRef[] {
  if (!Array.isArray(input)) return [];
  const out: QaPhotoRef[] = [];
  for (const entry of input) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ key: entry });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (!key) continue;
    out.push({
      key,
      annotatedKey: typeof row.annotatedKey === "string" ? row.annotatedKey : null,
      flatKey: typeof row.flatKey === "string" ? row.flatKey : null,
      comment: typeof row.comment === "string" ? row.comment : null,
    });
  }
  return out;
}

/**
 * The key that should actually be shown for a QA photo: the flattened image
 * when one exists, else the original. NEVER the bare overlay — on its own it is
 * marks on transparency, which renders as a black tile once any pipeline
 * converts it to JPEG.
 */
export function displayKeyFor(ref: QaPhotoRef): string {
  return ref.flatKey || ref.key;
}

/**
 * Backfill `flatKey` on refs that predate flattening (or whose composite failed
 * at save time). Best-effort and idempotent: refs that already carry a flatKey
 * are returned untouched, and a failed composite leaves the ref as-is so the
 * caller still shows the original photo.
 */
export async function ensureFlattened(
  refs: QaPhotoRef[],
  ownerId: string
): Promise<QaPhotoRef[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (ref.flatKey || !ref.annotatedKey) return ref;
      const flatKey = await compositeAnnotated(ref.key, ref.annotatedKey, ownerId);
      return flatKey ? { ...ref, flatKey } : ref;
    })
  );
}
