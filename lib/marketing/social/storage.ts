import "server-only";
import { randomUUID } from "node:crypto";
import { resolveS3 } from "@/lib/s3";

/**
 * Storage for the social post generator (2026-11-17). Evidence photos are
 * only ever READ (getObject); nothing here writes to an evidence key.
 * Derivatives are written under `marketing/social/<groupId>/<uuid>.jpg`: the
 * key carries no address, name or job number.
 */

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const EVIDENCE_KEY = /^(forms|jobs)\//;
const DERIVATIVE_KEY = /^marketing\/social\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.jpg$/;

function safeKey(key: string): boolean {
  return !/[\\\u0000- ]/.test(key) && key.split("/").every((part) => part && part !== "." && part !== "..");
}

async function readObject(key: string, maxBytes: number): Promise<Buffer> {
  const { client, bucket } = await resolveS3();
  const head = await client.headObject({ Bucket: bucket, Key: key }).promise();
  if (!head.ContentLength || head.ContentLength > maxBytes) throw new Error("The stored photo is empty or too large.");
  const object = await client.getObject({ Bucket: bucket, Key: key }).promise();
  const body = object.Body;
  const bytes = Buffer.isBuffer(body) ? body : body instanceof Uint8Array ? Buffer.from(body) : typeof body === "string" ? Buffer.from(body, "binary") : null;
  if (!bytes || bytes.length !== head.ContentLength) throw new Error("The stored photo could not be read.");
  return bytes;
}

/** The stored evidence photo (stamped, as the cleaner submitted it). Read only. */
export async function readEvidencePhoto(key: string): Promise<Buffer> {
  if (!EVIDENCE_KEY.test(key) || !safeKey(key)) throw new Error("This photo's storage location is not supported.");
  return readObject(key, MAX_EVIDENCE_BYTES);
}

export function newDerivativeKey(groupId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(groupId)) throw new Error("Invalid post id.");
  return `marketing/social/${groupId}/${randomUUID()}.jpg`;
}

export function isDerivativeKey(key: string | null | undefined): key is string {
  return typeof key === "string" && DERIVATIVE_KEY.test(key);
}

export async function putDerivative(key: string, bytes: Buffer): Promise<void> {
  if (!isDerivativeKey(key)) throw new Error("Not a social derivative key.");
  const { client, bucket } = await resolveS3();
  await client.putObject({ Bucket: bucket, Key: key, Body: bytes, ContentType: "image/jpeg", CacheControl: "private, max-age=300" }).promise();
}

export async function readDerivative(key: string): Promise<Buffer> {
  if (!isDerivativeKey(key)) throw new Error("Not a social derivative key.");
  return readObject(key, 9 * 1024 * 1024);
}

/** Best effort: a file that could not be removed is reported, never hidden. */
export async function deleteDerivative(key: string): Promise<boolean> {
  if (!isDerivativeKey(key)) return false;
  try {
    const { client, bucket } = await resolveS3();
    await client.deleteObject({ Bucket: bucket, Key: key }).promise();
    return true;
  } catch {
    return false;
  }
}
