import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      token?: string;
      rating?: number;
      comment?: string;
    };
    const token = String(body.token ?? "").trim();
    const rating = Number(body.rating ?? 0);
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";

    if (!token || !Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Invalid feedback payload." }, { status: 400 });
    }

    const feedback = await db.jobFeedback.findUnique({
      where: { token },
      select: { id: true, tokenExpiresAt: true },
    });
    if (!feedback) {
      return NextResponse.json({ error: "Feedback link not found." }, { status: 404 });
    }
    if (new Date(feedback.tokenExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This feedback link has expired." }, { status: 403 });
    }

    const updated = await db.jobFeedback.update({
      where: { id: feedback.id },
      data: {
        rating: Math.round(rating),
        comment: comment || null,
        submittedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, feedback: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not save feedback." }, { status: 400 });
  }
}