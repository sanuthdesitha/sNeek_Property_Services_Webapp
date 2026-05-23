import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { s3 } from "@/lib/s3";
import { z } from "zod";
import { randomUUID } from "crypto";

const schema = z.object({
  filename: z.string(),
  contentType: z.string(),
  partsCount: z.number().int().positive().max(10_000),
  folder: z.string().optional().default("uploads"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = schema.parse(await req.json());

    const ext = parsed.filename.split(".").pop() ?? "bin";
    const key = `${parsed.folder}/${session.user.id}/${randomUUID()}.${ext}`;
    const Bucket = process.env.S3_BUCKET_NAME!;

    const created = await s3
      .createMultipartUpload({ Bucket, Key: key, ContentType: parsed.contentType })
      .promise();
    if (!created.UploadId) throw new Error("S3 did not return UploadId");

    const partUrls: string[] = [];
    for (let i = 1; i <= parsed.partsCount; i++) {
      const url = await s3.getSignedUrlPromise("uploadPart", {
        Bucket,
        Key: key,
        UploadId: created.UploadId,
        PartNumber: i,
        Expires: 3600,
      });
      partUrls.push(url);
    }

    return NextResponse.json({ uploadId: created.UploadId, key, partUrls });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
