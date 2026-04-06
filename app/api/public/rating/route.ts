import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const SECRET = process.env.RATING_TOKEN_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "sneek-rating";

function buildRatingToken(jobId: string, clientId: string) {
  return crypto.createHmac("sha256", SECRET).update(`${jobId}:${clientId}`).digest("hex");
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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
    if (!job?.id) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const clientId = job.property?.clientId ?? null;
    if (!clientId) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (buildRatingToken(job.id, clientId) !== token) {
      return NextResponse.json({ error: "Invalid rating token." }, { status: 403 });
    }

    const rating = await db.clientSatisfactionRating.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, clientId, score: Math.round(score), comment: comment || null },
      update: { score: Math.round(score), comment: comment || null },
    });

    return NextResponse.json({ ok: true, rating });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Could not save rating." }, { status: 400 });
  }
}
