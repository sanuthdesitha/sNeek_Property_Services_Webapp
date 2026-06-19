import S3 from "aws-sdk/clients/s3";
import { db } from "@/lib/db";

// Env-built client kept for backward compatibility with modules that import the
// raw `s3` client directly (reports, multipart upload routes, etc.).
const s3 = new S3({
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION ?? "auto",
  signatureVersion: "v4",
});

const BUCKET = process.env.S3_BUCKET_NAME!;

/**
 * Settings-first storage config: prefer S3/R2 credentials saved in the
 * integrations Settings UI (AppSetting "integrationCredentials"), falling back
 * to environment variables when a field is empty. Cached briefly to avoid a DB
 * hit on every presign. A pure no-op when storage is configured via env only.
 */
type ResolvedS3 = { client: S3; bucket: string };
let s3Cache: { value: ResolvedS3; at: number } | null = null;
const S3_CACHE_TTL_MS = 60_000;

async function resolveS3(): Promise<ResolvedS3> {
  const now = Date.now();
  if (s3Cache && now - s3Cache.at < S3_CACHE_TTL_MS) return s3Cache.value;

  let creds: Record<string, string> = {};
  try {
    const row = await db.appSetting.findUnique({ where: { key: "integrationCredentials" } });
    creds = (row?.value as Record<string, string> | null) ?? {};
  } catch {
    creds = {};
  }

  const bucket = creds.s3BucketName || process.env.S3_BUCKET_NAME || "";
  const hasDbCreds = !!(creds.awsAccessKeyId && creds.awsSecretAccessKey);
  // If no DB credentials are set, reuse the env-built client as-is.
  const client = hasDbCreds
    ? new S3({
        endpoint: creds.s3Endpoint || process.env.S3_ENDPOINT,
        accessKeyId: creds.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: creds.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
        region: creds.s3Region || process.env.S3_REGION || "auto",
        signatureVersion: "v4",
      })
    : s3;

  const value: ResolvedS3 = { client, bucket };
  s3Cache = { value, at: now };
  return value;
}

/** Generate a presigned PUT URL for direct-upload from browser. */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300
): Promise<string> {
  const { client, bucket } = await resolveS3();
  return client.getSignedUrlPromise("putObject", {
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    Expires: expiresIn,
  });
}

/** Generate a presigned GET URL for temporary access. */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const { client, bucket } = await resolveS3();
  return client.getSignedUrlPromise("getObject", {
    Bucket: bucket,
    Key: key,
    Expires: expiresIn,
  });
}

/** Public URL (only for public buckets / CDN prefix). */
export function publicUrl(key: string): string {
  const base = (process.env.S3_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const encodedKey = String(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encodedKey}`;
}

/** Delete an object from S3. */
export async function deleteObject(key: string): Promise<void> {
  await s3.deleteObject({ Bucket: BUCKET, Key: key }).promise();
}

export { s3 };
