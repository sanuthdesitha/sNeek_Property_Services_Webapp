import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET ?? "sneek-uploads";
const PUBLIC_URL = process.env.S3_PUBLIC_URL ?? "";

export async function generatePresignedUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  await s3.send(command);
}

export function getPublicUrl(key: string): string {
  if (PUBLIC_URL) {
    return `${PUBLIC_URL}/${key}`;
  }
  return `https://${BUCKET}.s3.${process.env.S3_REGION ?? "auto"}.amazonaws.com/${key}`;
}

export function generateUploadKey(
  prefix: string,
  extension: string,
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${timestamp}-${random}.${extension}`;
}
