import S3 from "aws-sdk/clients/s3";

const s3 = new S3({
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION ?? "auto",
  signatureVersion: "v4",
});

const BUCKET = process.env.S3_BUCKET_NAME!;

/** Generate a presigned PUT URL for direct-upload from browser. */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300
): Promise<string> {
  return s3.getSignedUrlPromise("putObject", {
    Bucket: BUCKET,
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
  return s3.getSignedUrlPromise("getObject", {
    Bucket: BUCKET,
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
