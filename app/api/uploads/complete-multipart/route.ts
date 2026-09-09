import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { resolveS3, publicUrl } from "@/lib/s3";
import { z } from "zod";

const schema = z.object({
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(z.object({ PartNumber: z.number().int(), ETag: z.string() })),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = schema.parse(await req.json());
    if (parsed.key.split("/").at(-2) !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { client: s3, bucket: Bucket } = await resolveS3();
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
