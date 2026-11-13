import "server-only";
import { db } from "@/lib/db";
import { resolveS3 } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { computePhotoIntegrity } from "./photo-integrity";

const MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED_KEY = /^(forms|jobs)\//;

/** Reads one stored evidence photo. Fixed error text only (no storage detail is stored). */
async function readStoredPhoto(key: string): Promise<Buffer> {
  if (!SUPPORTED_KEY.test(key) || /[\\\u0000- ]/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("This photo's storage location is not supported for integrity checks.");
  }
  const { client, bucket } = await resolveS3();
  const head = await client.headObject({ Bucket: bucket, Key: key }).promise();
  if (!head.ContentLength || head.ContentLength > MAX_BYTES) throw new Error("The stored photo is empty or larger than 25 MB.");
  const object = await client.getObject({ Bucket: bucket, Key: key, ...(head.ETag ? { IfMatch: head.ETag } : {}) }).promise();
  const bytes = Buffer.isBuffer(object.Body) ? object.Body : object.Body instanceof Uint8Array ? Buffer.from(object.Body) : null;
  if (!bytes || bytes.length !== head.ContentLength) throw new Error("The stored photo changed or could not be read.");
  return bytes;
}

const SAFE_ERRORS = new Set([
  "This photo's storage location is not supported for integrity checks.",
  "The stored photo is empty or larger than 25 MB.",
  "The stored photo changed or could not be read.",
]);

/**
 * pg-boss `media-integrity` (every 5 minutes): newest unchecked photos first,
 * 40 per run. Hashes come from the stored photo; the capture time from EXIF in
 * the original upload when kept, else the stored photo. A photo that cannot be
 * read is marked checked with a reason (shown as "Could not check"), never as
 * a pass. Older photos are filled in the same way, from their stored bytes.
 */
export async function processPhotoIntegrityQueue(batch = 40): Promise<{ processed: number; failed: number }> {
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const rows = await db.submissionMedia.findMany({
    where: { mediaType: "PHOTO", integrityCheckedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: batch,
    select: { id: true, s3Key: true, originalS3Key: true },
  });
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const stored = await readStoredPhoto(row.s3Key);
      const facts = await computePhotoIntegrity(stored, timezone);
      let captured = { capturedAt: facts.capturedAt, capturedAtSource: facts.capturedAtSource as string | null };
      if (row.originalS3Key && row.originalS3Key !== row.s3Key && !facts.capturedAt) {
        const original = await computePhotoIntegrity(await readStoredPhoto(row.originalS3Key), timezone).catch(() => null);
        if (original?.capturedAt) captured = { capturedAt: original.capturedAt, capturedAtSource: original.capturedAtSource };
      }
      const saved = await db.submissionMedia.updateMany({
        where: { id: row.id, integrityCheckedAt: null },
        data: { contentSha256: facts.contentSha256, perceptualHash: facts.perceptualHash, ...captured, integrityCheckedAt: new Date(), integrityError: null },
      });
      if (saved.count) processed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : "The photo could not be read as an image.";
      await db.submissionMedia.updateMany({ where: { id: row.id, integrityCheckedAt: null }, data: { integrityCheckedAt: new Date(), integrityError: message } }).catch(() => undefined);
    }
  }
  return { processed, failed };
}
