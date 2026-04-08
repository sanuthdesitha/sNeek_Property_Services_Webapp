import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const schema = z.object({
  token: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(4000).optional().default(""),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());

    const existing = await db.jobFeedback.findUnique({
      where: { token: body.token },
      select: { id: true, tokenExpiresAt: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Feedback request not found." }, { status: 404 });
    }
    if (new Date(existing.tokenExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This feedback link has expired." }, { status: 400 });
    }

    const updated = await db.jobFeedback.update({
      where: { token: body.token },
      data: {
        rating: body.rating,
        comment: body.comment || null,
        submittedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, feedback: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not save feedback." }, { status: 400 });
  }
}
