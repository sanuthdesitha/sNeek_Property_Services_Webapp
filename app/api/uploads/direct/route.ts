import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { once } from "events";
import { createReadStream, createWriteStream } from "fs";
import { promises as fs } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";
import { requireSession } from "@/lib/auth/session";
import { publicUrl, s3 } from "@/lib/s3";
import { compressVideoToMp4 } from "@/lib/media/video-compression";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_BYTES = Number(process.env.VIDEO_MAX_UPLOAD_MB ?? 150) * 1024 * 1024;
const MAX_STORED_VIDEO_BYTES = Number(process.env.VIDEO_MAX_STORED_MB ?? 25) * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp", ".mpeg", ".mpg"]);

function isVideoUpload(file: File): boolean {
  if (file.type.toLowerCase().startsWith("video/")) return true;
  const ext = extname(file.name ?? "").toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

async function writeUploadedFileToPath(file: File, targetPath: string) {
  const output = createWriteStream(targetPath);
  const reader = file.stream().getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value || chunk.value.length === 0) continue;
      if (!output.write(Buffer.from(chunk.value))) {
        await once(output, "drain");
      }
    }
  } finally {
    reader.releaseLock();
    output.end();
  }
  await once(output, "finish");
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const form = (await req.formData()) as globalThis.FormData;

    const file = form.get("file");
    const folderRaw = form.get("folder");
    const folder = typeof folderRaw === "string" && folderRaw.trim() ? folderRaw.trim() : "uploads";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!file.size) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    const isVideo = isVideoUpload(file);
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      const limitMb = Math.floor(maxBytes / (1024 * 1024));
      return NextResponse.json({ error: `File too large (max ${limitMb}MB)` }, { status: 400 });
    }

    if (isVideo) {
      const tempFolder = join(tmpdir(), `upload-${randomUUID()}`);
      await fs.mkdir(tempFolder, { recursive: true });

      const ext = extname(file.name ?? "") || ".mp4";
      const inputPath = join(tempFolder, `input${ext.toLowerCase()}`);
      const outputPath = join(tempFolder, "output.mp4");

      let compressed = false;
      try {
        await writeUploadedFileToPath(file, inputPath);
        const inStat = await fs.stat(inputPath);

        try {
          await compressVideoToMp4(inputPath, outputPath);
          let outStat = await fs.stat(outputPath);

          if (outStat.size > MAX_STORED_VIDEO_BYTES) {
            await compressVideoToMp4(inputPath, outputPath, {
              maxDimension: 854,
              crf: 36,
              maxRateKbps: 650,
              bufferKbps: 1300,
              audioBitrateKbps: 48,
            });
            outStat = await fs.stat(outputPath);
          }

          compressed = outStat.size > 0 && outStat.size < inStat.size;
        } catch {
          compressed = false;
        }

        const finalPath = compressed ? outputPath : inputPath;
        const finalStat = await fs.stat(finalPath);
        if (finalStat.size > MAX_STORED_VIDEO_BYTES) {
          const limitMb = Math.floor(MAX_STORED_VIDEO_BYTES / (1024 * 1024));
          return NextResponse.json(
            {
              error: `Compressed video is still too large. Keep uploads under ${limitMb}MB after compression or trim the clip before uploading.`,
            },
            { status: 400 }
          );
        }
        const key = `${folder}/${session.user.id}/${randomUUID()}.${compressed ? "mp4" : ext.replace(/^\./, "")}`;

        await s3
          .putObject({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: key,
            Body: createReadStream(finalPath),
            ContentLength: finalStat.size,
            ContentType: compressed ? "video/mp4" : file.type || "application/octet-stream",
          })
          .promise();

        return NextResponse.json({
          key,
          url: publicUrl(key),
          compressed,
          originalBytes: file.size,
          storedBytes: finalStat.size,
        });
      } finally {
        await fs.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
      }
    }

    const extension = file.name.includes(".") ? file.name.split(".").pop() ?? "bin" : "bin";
    const key = `${folder}/${session.user.id}/${randomUUID()}.${extension}`;

    const bytes = await file.arrayBuffer();
    const body = Buffer.from(bytes);

    await s3
      .putObject({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: key,
        Body: body,
        ContentType: file.type || "application/octet-stream",
      })
      .promise();

    return NextResponse.json({ key, url: publicUrl(key) });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 400 });
  }
}
