import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { resolveS3, publicUrl } from "@/lib/s3";
import { isAllowedUploadContentType } from "@/lib/uploads/validate";

const schema = z.object({
  key: z.string().min(1).max(1000), uploadId: z.string().min(1),
  size: z.number().int().positive().max(5 * 1024 ** 4),
  partSize: z.number().int().min(5 * 1024 ** 2).max(5 * 1024 ** 3),
  contentType: z.string(),
});

/** Inspect one owned allocation; never infer success from a network failure. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const data = schema.parse(await req.json());
    const segments = data.key.split("/");
    if (segments.at(-2) !== session.user.id || segments.some(p => !p || p === "." || p === "..") || /[\\\u0000-\u0020\u007f]/.test(data.key)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const count = Math.ceil(data.size / data.partSize);
    if (count > 10_000 || !isAllowedUploadContentType(data.contentType, data.key)) {
      return NextResponse.json({ error: "Invalid upload file." }, { status: 400 });
    }
    const { client, bucket: Bucket } = await resolveS3();
    const Key = data.key;
    const completedObject = async () => {
      try {
        const head = await client.headObject({ Bucket, Key }).promise();
        if (head.ContentLength !== data.size) throw new Error("Stored file size differs from the retained video. Keep the original for review.");
        return { completed: true, key: Key, url: publicUrl(Key) };
      } catch (error: any) {
        if (error.code === "NotFound" || error.code === "NoSuchKey" || error.statusCode === 404) return null;
        throw error;
      }
    };
    const existing = await completedObject();
    if (existing) return NextResponse.json(existing);
    let uploadId = data.uploadId;
    const uploadedParts: { PartNumber: number; ETag: string; Size: number }[] = [];
    try {
      let marker: number | undefined;
      do {
        const page = await client.listParts({ Bucket, Key, UploadId: uploadId, PartNumberMarker: marker }).promise();
        for (const part of page.Parts ?? []) {
          const number = part.PartNumber ?? 0;
          const expectedSize = Math.min(data.partSize, data.size - (number - 1) * data.partSize);
          if (number < 1 || number > count || !part.ETag || part.Size !== expectedSize) throw new Error("Retained video does not match its uploaded parts. Keep the original for review.");
          uploadedParts.push({ PartNumber: number, ETag: part.ETag, Size: part.Size });
        }
        if (!page.IsTruncated) break;
        if (!page.NextPartNumberMarker || page.NextPartNumberMarker === marker) throw new Error("Storage returned an invalid parts page.");
        marker = page.NextPartNumberMarker;
      } while (true);
    } catch (error: any) {
      if (error.code !== "NoSuchUpload") throw error;
      // Completion may have succeeded just before ListParts. Check again before
      // replacing an expired/previously aborted allocation at the SAME key.
      const completed = await completedObject();
      if (completed) return NextResponse.json(completed);
      uploadedParts.length = 0;
      const created = await client.createMultipartUpload({ Bucket, Key, ContentType: data.contentType }).promise();
      if (!created.UploadId) throw new Error("Storage did not allocate the resumed upload.");
      uploadId = created.UploadId;
    }
    const partUrls: string[] = [];
    for (let number = 1; number <= count; number++) {
      partUrls.push(await client.getSignedUrlPromise("uploadPart", { Bucket, Key, UploadId: uploadId, PartNumber: number, Expires: 3600 }));
    }
    return NextResponse.json({ key: Key, uploadId, partUrls, uploadedParts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not resume upload. Retry when connected." }, {
      status: error.message === "UNAUTHORIZED" ? 401 : 400,
    });
  }
}
