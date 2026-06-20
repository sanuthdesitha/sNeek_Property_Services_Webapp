import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAuthoritativeQaReview } from "@/lib/qa/authority";

// List the QA reviews/scores recorded for a job, newest first, flagging which
// one is currently authoritative (drives the job's pass/fail + completion).
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });

    const [reviews, authoritative] = await Promise.all([
      db.qAReview.findMany({
        where: { jobId },
        orderBy: { createdAt: "desc" },
        include: {
          reviewedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      getAuthoritativeQaReview(jobId),
    ]);

    return NextResponse.json({
      authoritativeReviewId: authoritative?.id ?? null,
      reviews: reviews.map((r) => ({
        id: r.id,
        score: r.score,
        passed: r.passed,
        kind: r.kind,
        notes: r.notes,
        reviewedBy: r.reviewedBy,
        createdAt: r.createdAt,
        editedAt: r.editedAt,
        isAuthoritative: r.id === authoritative?.id,
      })),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
