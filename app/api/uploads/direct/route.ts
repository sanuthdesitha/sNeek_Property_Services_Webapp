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
import { sanitizeUploadFolder, isAllowedUploadContentType } from "@/lib/uploads/validate";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
// The request only carries bytes to S3 now; transcoding happens after the
// response, so this no longer has to outlive an ffmpeg run.
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_BYTES = Number(process.env.VIDEO_MAX_UPLOAD_MB ?? 150) * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp", ".mpeg", ".mpg"]);

function isVideoUpload(file: File): boolean {
  if (file.type.toLowerCase().startsWith("video/")) return true;
  const ext = extname(file.name ?? "").toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Transcode a video that is ALREADY in S3, then replace it in place.
 *
 * Deliberately after the response. ffmpeg used to run inside the request while
 * the cleaner's phone held the connection open: a 100MB clip at crf 34 takes
 * minutes on a modest box, the proxy timed the request out long before that,
 * and the cleaner saw a failure for a file that had uploaded perfectly. Worse,
 * the client then retried — re-uploading AND re-transcoding the same video,
 * which is how one clip could occupy the server for ten minutes and still be
 * reported as failed.
 *
 * The key is reused so the URL already handed to the client stays valid and no
 * database row needs revisiting. If this fails, or the process dies mid-run,
 * the original stays where it is — a bigger file is a far better outcome than
 * a missing one.
 */
async function compressInBackground(input: {
  key: string;
  tempFolder: string;
  inputPath: string;
  outputPath: string;
}) {
  try {
    await compressVideoToMp4(input.inputPath, input.outputPath);
    const [inStat, outStat] = await Promise.all([
      fs.stat(input.inputPath),
      fs.stat(input.outputPath),
    ]);
    // A transcode that came out bigger is not an improvement.
    if (outStat.size > 0 && outStat.size < inStat.size) {
      await s3
        .putObject({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: input.key,
          Body: createReadStream(input.outputPath),
          ContentLength: outStat.size,
          ContentType: "video/mp4",
        })
        .promise();
      logger.info(
        { key: input.key, from: inStat.size, to: outStat.size },
        "Video compressed after upload"
      );
    }
  } catch (err) {
    logger.warn({ err, key: input.key }, "Background video compression failed; original kept");
  } finally {
    await fs.rm(input.tempFolder, { recursive: true, force: true }).catch(() => {});
  }
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
    const folder = sanitizeUploadFolder(form.get("folder"));

    if (folder === null) {
      return NextResponse.json({ error: "Invalid upload folder." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!file.size) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (!isAllowedUploadContentType(file.type, file.name)) {
      return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
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

      let handedOff = false;
      try {
        await writeUploadedFileToPath(file, inputPath);
        const inStat = await fs.stat(inputPath);

        // The ORIGINAL goes up first and the response goes out immediately.
        // The cleaner's phone is off the hook the moment the bytes land,
        // which is the whole fix: the connection no longer has to survive a
        // transcode it has no stake in.
        const key = `${folder}/${session.user.id}/${randomUUID()}.${ext.replace(/^\./, "")}`;
        await s3
          .putObject({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: key,
            Body: createReadStream(inputPath),
            ContentLength: inStat.size,
            ContentType: file.type || "video/mp4",
          })
          .promise();

        handedOff = true;
        void compressInBackground({ key, tempFolder, inputPath, outputPath });

        return NextResponse.json({
          key,
          url: publicUrl(key),
          // Compression is asynchronous now, so the client cannot be told
          // whether it happened. It does not need to know: the URL is final.
          compressing: true,
          originalBytes: file.size,
          storedBytes: inStat.size,
        });
      } finally {
        // Only clean up on the failure path — on success the background job
        // still needs the temp files and removes them itself.
        if (!handedOff) {
          await fs.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
        }
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
