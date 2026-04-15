import { requireApiSession, apiSuccess, apiError } from "@/lib/auth/api";
import { generatePresignedUrl, generateUploadKey } from "@/lib/uploads/s3";
import { NextRequest } from "next/server";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "application/pdf"];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(req: NextRequest) {
  const session = await requireApiSession();

  const body = await req.json();
  const { filename, contentType, prefix } = body;

  if (!filename || !contentType) {
    return apiError("filename and contentType are required", 400);
  }

  if (!ALLOWED_TYPES.includes(contentType)) {
    return apiError(`File type ${contentType} not allowed. Allowed: ${ALLOWED_TYPES.join(", ")}`, 400);
  }

  const extension = filename.split(".").pop() ?? "bin";
  const key = generateUploadKey(prefix ?? "uploads", extension);

  const url = await generatePresignedUrl(key, contentType);

  return apiSuccess({
    uploadUrl: url,
    key,
    publicUrl: `/${key}`,
    maxSize: MAX_SIZE,
  });
}
