import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildRatingToken } from "@/lib/client/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      jobId?: string;
      token?: string;
      score?: number;
      comment?: string;
    };
    const jobId = String(body.jobId ?? "").trim();
    const token = String(body.token ?? "").trim();
    const score = Number(body.score ?? 0);
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";

    if (!jobId || !token || !Number.isFinite(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: "Invalid rating payload." }, { status: 400 });
    }

    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { id: true, property: { select: { clientId: true } } },
    });
    if (!job?.id || !job.property?.clientId) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (buildRatingToken(job.id, job.property.clientId) !== token) {
      return NextResponse.json({ error: "Invalid rating token." }, { status: 403 });
    }

    const rating = await db.clientSatisfactionRating.upsert({
      where: { jobId: job.id },
      create: {
        jobId: job.id,
        clientId: job.property.clientId,
        score: Math.round(score),
        comment: comment || null,
      },
      update: { score: Math.round(score), comment: comment || null },
    });

    return NextResponse.json({ ok: true, rating });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not save rating." }, { status: 400 });
  }
}