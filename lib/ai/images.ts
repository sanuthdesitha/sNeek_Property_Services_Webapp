import "server-only";
import sharp from "sharp";
import { resolveS3 } from "@/lib/s3";
import type { VisionImage } from "./vision";

/** Call only after authorizing this exact stored key against the job/template. Never resolves URLs. */
export async function loadVisionImage(storageKey: string, id: string): Promise<VisionImage> {
  if (!/^(forms|form-references)\//.test(storageKey) || /[\\\u0000-\u0020]/.test(storageKey) || storageKey.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid stored image key.");
  const { client, bucket } = await resolveS3();
  const head = await client.headObject({ Bucket: bucket, Key: storageKey }).promise();
  if (!head.ContentLength || head.ContentLength > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(head.ContentType ?? "")) throw new Error("Image must be JPEG, PNG, WebP or GIF and at most 5 MB.");
  const object = await client.getObject({ Bucket: bucket, Key: storageKey, Range: `bytes=0-${head.ContentLength - 1}`, ...(head.ETag ? { IfMatch: head.ETag } : {}) }).promise();
  const bytes = Buffer.isBuffer(object.Body) ? object.Body : object.Body instanceof Uint8Array ? Buffer.from(object.Body) : null;
  if (!bytes || bytes.length !== head.ContentLength) throw new Error("Stored image changed or could not be read.");
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  if (!["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) throw new Error("Stored object is not a supported image.");
  const resized = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { id, mediaType: "image/jpeg", data: resized.toString("base64") };
}
