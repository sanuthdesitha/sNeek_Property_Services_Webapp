import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { recomputeJobQaOutcome } from "@/lib/qa/authority";

const patchSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  passed: z.boolean().optional(),
  notes: z.string().trim().max(6000).nullable().optional(),
});

// Admin edits a QA score. If `passed` isn't given it's re-derived from the score
// vs the QA failure threshold. The job's status/completion is recomputed from
// the authoritative review afterwards (a QA inspection still outranks this).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json());
    const existing = await db.qAReview.findUnique({ where: { id: params.id }, select: { id: true, jobId: true, score: true } });
    if (!existing) return NextResponse.json({ error: "QA review not found." }, { status: 404 });

    const settings = await getAppSettings();
    const nextScore = body.score ?? existing.score;
    const nextPassed =
      body.passed ?? nextScore >= settings.qaAutomation.failureThreshold;

    await db.qAReview.update({
      where: { id: params.id },
      data: {
        score: nextScore,
        passed: nextPassed,
        notes: body.notes === undefined ? undefined : body.notes,
        editedById: session.user.id,
        editedAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: existing.jobId,
        action: "QA_REVIEW_EDIT",
        entity: "QAReview",
        entityId: params.id,
        after: { score: nextScore, passed: nextPassed } as any,
      },
    });

    const outcome = await recomputeJobQaOutcome(existing.jobId);
    return NextResponse.json({ ok: true, outcome });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

// Admin deletes a QA score (e.g. a bogus quick pass). The job is recomputed from
// whatever authoritative review remains.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.qAReview.findUnique({ where: { id: params.id }, select: { id: true, jobId: true } });
    if (!existing) return NextResponse.json({ error: "QA review not found." }, { status: 404 });

    await db.$transaction(async (tx) => {
      // Detach any QA form submissions so the delete doesn't violate the FK.
      await tx.qaFormSubmission.updateMany({ where: { qaReviewId: params.id }, data: { qaReviewId: null } });
      await tx.qAReview.delete({ where: { id: params.id } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: existing.jobId,
          action: "QA_REVIEW_DELETE",
          entity: "QAReview",
          entityId: params.id,
        },
      });
    });

    const outcome = await recomputeJobQaOutcome(existing.jobId);
    return NextResponse.json({ ok: true, outcome });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
