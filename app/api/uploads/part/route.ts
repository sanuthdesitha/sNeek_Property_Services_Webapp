import { NextRequest, NextResponse } from "next/server";
import { Readable, Transform } from "node:stream";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { resolveS3 } from "@/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 300;
const schema = z.object({
  key: z.string().min(1), uploadId: z.string().min(1),
  partNumber: z.coerce.number().int().min(1).max(10_000),
  size: z.coerce.number().int().min(1).max(5 * 1024 ** 3),
});

/** Bounded streaming fallback for buckets that cannot accept browser CORS PUTs. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    const data = schema.parse({
      key: req.nextUrl.searchParams.get("key"),
      uploadId: req.nextUrl.searchParams.get("uploadId"),
      partNumber: req.nextUrl.searchParams.get("partNumber"),
      size: req.headers.get("x-upload-size"),
    });
    if (data.key.split("/").at(-2) !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!req.body) return NextResponse.json({ error: "Missing upload part" }, { status: 400 });
    const { client, bucket } = await resolveS3();
    let received = 0;
    const bounded = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > data.size ? new Error("Upload part exceeds declared size") : null, chunk);
      },
      flush(callback) {
        callback(received === data.size ? null : new Error("Incomplete upload part"));
      },
    });
    const source = Readable.fromWeb(req.body as any);
    source.on("error", (error) => bounded.destroy(error));
    const upload = client.uploadPart({
      Bucket: bucket, Key: data.key, UploadId: data.uploadId,
      PartNumber: data.partNumber, ContentLength: data.size, Body: source.pipe(bounded),
    });
    const abort = () => { upload.abort(); source.destroy(); bounded.destroy(); };
    req.signal.addEventListener("abort", abort, { once: true });
    try {
      req.signal.throwIfAborted();
      const result = await upload.promise();
      if (!result.ETag) throw new Error("Storage did not confirm the uploaded part");
      return NextResponse.json({ etag: result.ETag });
    } finally {
      req.signal.removeEventListener("abort", abort);
      source.destroy();
      bounded.destroy();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? "Upload part failed" }, {
      status: error.message === "UNAUTHORIZED" ? 401 : 400,
    });
  }
}
