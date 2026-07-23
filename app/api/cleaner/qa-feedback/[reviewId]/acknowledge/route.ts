import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Cleaner acknowledges a QA review outcome on one of their own jobs ("I've
 * read this"). IDOR-guarded: the review's job must carry a non-removed
 * assignment for the signed-in cleaner. Sets cleanerAcknowledgedAt once (first
 * acknowledgement wins) and audits. Follows the coaching acknowledge route.
 */
export async function POST(_req: Request, { params }: { params: { reviewId: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const review = await db.qAReview.findFirst({
      where: {
        id: params.reviewId,
        job: { assignments: { some: { userId: session.user.id, removedAt: null } } },
      },
      select: { id: true, jobId: true, cleanerAcknowledgedAt: true },
    });
    if (!review) {
      return NextResponse.json({ error: "Review not found." }, { status: 404 });
    }
    if (review.cleanerAcknowledgedAt) {
      return NextResponse.json({
        id: review.id,
        cleanerAcknowledgedAt: review.cleanerAcknowledgedAt,
      });
    }

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.qAReview.update({
        where: { id: review.id },
        data: { cleanerAcknowledgedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: review.jobId,
          action: "QA_FEEDBACK_ACKNOWLEDGED",
          entity: "QAReview",
          entityId: review.id,
          after: { cleanerAcknowledgedAt: next.cleanerAcknowledgedAt } as any,
        },
      });

      return next;
    });

    return NextResponse.json({ id: updated.id, cleanerAcknowledgedAt: updated.cleanerAcknowledgedAt });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not acknowledge." }, { status });
  }
}
