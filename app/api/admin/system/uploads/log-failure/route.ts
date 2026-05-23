import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  filename: z.string(),
  size: z.number().int(),
  mime: z.string(),
  reason: z.string(),
  message: z.string().optional(),
  jobId: z.string().optional(),
  context: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  // No auth gate — anonymous users can record their own upload failures; we tag with session if present.
  const session = await getSession();
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  await db.uploadFailure.create({
    data: {
      ...parsed.data,
      userId: session?.user?.id,
    },
  });
  return NextResponse.json({ ok: true });
}
