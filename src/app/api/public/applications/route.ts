import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const schema = z.object({
  positionId: z.string().min(1),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(32).optional(),
  coverLetter: z.string().trim().max(5000).optional(),
  resumeUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  answers: z.record(z.any()).optional(),
});

export async function POST(req: Request) {
  let payload: z.infer<typeof schema>;
  try {
    payload = schema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.issues?.[0]?.message ?? "Invalid application data." },
      { status: 400 }
    );
  }

  const position = await db.hiringPosition.findUnique({
    where: { id: payload.positionId },
    select: { id: true, isPublished: true, title: true },
  });
  if (!position || !position.isPublished) {
    return NextResponse.json({ error: "This position is no longer accepting applications." }, { status: 404 });
  }

  const created = await db.hiringApplication.create({
    data: {
      positionId: position.id,
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone || null,
      coverLetter: payload.coverLetter || null,
      resumeUrl: payload.resumeUrl || null,
      answers: payload.answers ?? null,
      status: "NEW",
    },
    select: { id: true },
  });

  logger.info(
    { applicationId: created.id, positionId: position.id, email: payload.email },
    "New hiring application received"
  );

  return NextResponse.json({ ok: true, applicationId: created.id });
}