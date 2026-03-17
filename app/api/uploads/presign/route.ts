import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getPresignedUploadUrl } from "@/lib/s3";
import { z } from "zod";
import { randomUUID } from "crypto";

const schema = z.object({
  filename: z.string(),
  contentType: z.string(),
  folder: z.string().optional().default("uploads"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = schema.parse(await req.json());

    const ext = body.filename.split(".").pop() ?? "bin";
    const key = `${body.folder}/${session.user.id}/${randomUUID()}.${ext}`;

    const uploadUrl = await getPresignedUploadUrl(key, body.contentType);

    return NextResponse.json({ uploadUrl, key });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
