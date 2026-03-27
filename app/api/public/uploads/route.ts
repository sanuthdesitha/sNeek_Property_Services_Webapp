import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extname } from "path";
import { publicUrl, s3 } from "@/lib/s3";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"]);

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }
    if (!file.size || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File must be under 12MB." }, { status: 400 });
    }
    const ext = extname(file.name || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: "Only PDF, DOC, DOCX, JPG, and PNG files are allowed." }, { status: 400 });
    }

    const key = `public/hiring/${randomUUID()}${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await s3
      .putObject({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: key,
        Body: bytes,
        ContentType: file.type || "application/octet-stream",
      })
      .promise();

    return NextResponse.json({ ok: true, key, url: publicUrl(key), fileName: file.name, mimeType: file.type || null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed." }, { status: 400 });
  }
}

