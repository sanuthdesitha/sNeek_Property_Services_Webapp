import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { resolveS3 } from "@/lib/s3";

const schema = z.object({ key: z.string().min(1), uploadId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const { key, uploadId } = schema.parse(await req.json());
    if (key.split("/").at(-2) !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { client, bucket } = await resolveS3();
    await client.abortMultipartUpload({ Bucket: bucket, Key: key, UploadId: uploadId }).promise();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? "Could not cancel upload" }, {
      status: error.message === "UNAUTHORIZED" ? 401 : 400,
    });
  }
}
