import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getPresignedUploadUrl } from "@/lib/s3";
import { sanitizeUploadFolder, isAllowedUploadContentType } from "@/lib/uploads/validate";
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

    const folder = sanitizeUploadFolder(body.folder);
    if (folder === null) {
      return NextResponse.json({ error: "Invalid upload folder." }, { status: 400 });
    }
    if (!isAllowedUploadContentType(body.contentType, body.filename)) {
      return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
    }

    const ext = body.filename.split(".").pop() ?? "bin";
    const key = `${folder}/${session.user.id}/${randomUUID()}.${ext}`;

    const uploadUrl = await getPresignedUploadUrl(key, body.contentType);

    return NextResponse.json({ uploadUrl, key });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
