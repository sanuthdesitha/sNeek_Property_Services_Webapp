import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { s3, publicUrl } from "@/lib/s3";
import { z } from "zod";

const schema = z.object({
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(z.object({ PartNumber: z.number().int(), ETag: z.string() })),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const parsed = schema.parse(await req.json());

    const Bucket = process.env.S3_BUCKET_NAME!;
    await s3
      .completeMultipartUpload({
        Bucket,
        Key: parsed.key,
        UploadId: parsed.uploadId,
        MultipartUpload: { Parts: parsed.parts },
      })
      .promise();

    return NextResponse.json({ url: publicUrl(parsed.key), key: parsed.key });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
