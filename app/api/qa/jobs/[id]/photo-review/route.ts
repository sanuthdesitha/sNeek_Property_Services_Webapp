import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";
import { photoSourceFingerprint, photoSubmissionInclude } from "@/lib/ai/photo-review";
import { getVisionSettings } from "@/lib/ai/vision-settings";
import { visionSettingsSchema } from "@/lib/ai/vision-settings-schema";
import { proposedPhotoDeduction, parsePhotoReviewResult } from "@/lib/ai/photo-review-policy";
import { getAppSettings } from "@/lib/settings";
import { ratingForScore } from "@/lib/accountability/scoring";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { deriveVisionFields } from "@/lib/ai/form-fields";
import { jobFormProperty } from "@/lib/forms/job-form-property";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("analyze") }),
  z.object({ action: z.literal("dismiss"), analysisId: z.string().min(1), reason: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal("approve"), analysisId: z.string().min(1), reason: z.string().trim().min(3).max(2000), findingIds: z.array(z.string()).min(1).max(200), expectedReviewId: z.string().min(1), expectedScore: z.number().finite().min(0).max(100) }),
]);
async function authorize(jobId: string, tx: Pick<typeof db, "qaAssignment"> = db) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
  if (session.user.role === Role.QA_INSPECTOR && !await tx.qaAssignment.findFirst({ where: { jobId, status: { not: "CANCELLED" }, ...qaAssignmentOwnerWhere(session.user.id) }, select: { id: true } })) throw new ReviewError("FORBIDDEN");
  return session;
}
function authoritative(reviews: any[]) {
  return [...reviews].sort((a, b) => ({ QA: 3, ADMIN: 2, AUTO: 1 }[b.kind as "QA"] ?? 1) - ({ QA: 3, ADMIN: 2, AUTO: 1 }[a.kind as "QA"] ?? 1) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}
class ReviewError extends Error {}
function failure(error: unknown) {
  const message = error instanceof ReviewError || (error instanceof Error && ["UNAUTHORIZED", "FORBIDDEN"].includes(error.message)) ? error.message : error instanceof z.ZodError ? "Invalid photo review request or saved analysis." : "Could not update photo review. Refresh before trying again.";
  return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : error instanceof ReviewError ? 409 : error instanceof z.ZodError ? 400 : 503, headers });
}
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await authorize(params.id);
    const submission = await db.formSubmission.findFirst({ where: { jobId: params.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { ...photoSubmissionInclude, aiPhotoReview: true } });
    const config = await getVisionSettings();
    const scoreReview = authoritative(await db.qAReview.findMany({ where: { jobId: params.id }, select: { id: true, score: true, createdAt: true, kind: true, reviewedById: true } }));
    const canApprove = Boolean(scoreReview && submission && submission.job.status !== "INVOICED" && (session.user.role !== Role.QA_INSPECTOR || (scoreReview.kind === "QA" && scoreReview.reviewedById === session.user.id)));
    const review = submission?.aiPhotoReview;
    const data = submission?.data as Record<string, unknown> | undefined;
    const fields = submission ? deriveVisionFields(data?.__templateSchema, data ?? {}, jobFormProperty(data?.__templateSchema, submission.job.property), submission.laundryReady === true) : [];
    const observations = review?.result ? parsePhotoReviewResult(review.result).observations : [];
    const photos = await Promise.all(observations.map(async observation => {
      const media = submission?.media.find(item => item.id === observation.mediaId);
      const refs = fields.find(field => field.id === observation.fieldId)?.referenceKeys ?? [];
      return { mediaId: observation.mediaId, url: media ? await getPresignedDownloadUrl(media.s3Key, 600).catch(() => null) : null, referenceUrls: await Promise.all(refs.map(key => getPresignedDownloadUrl(key, 600).catch(() => null))) };
    }));
    return NextResponse.json({ enabled: config.comparisonEnabled, hasSubmission: Boolean(submission), review, scoreReview: scoreReview ? { id: scoreReview.id, score: scoreReview.score } : null, canApprove, photos }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await authorize(params.id);
    if (session.impersonation) throw new ReviewError("FORBIDDEN");
    const body = bodySchema.parse(await req.json());
    const config = await getVisionSettings();
    const appSettings = await getAppSettings();
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.id}))`;
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${params.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "QaAssignment" WHERE "jobId" = ${params.id} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "FormSubmission" WHERE "jobId" = ${params.id} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "SubmissionMedia" WHERE "submissionId" IN (SELECT "id" FROM "FormSubmission" WHERE "jobId" = ${params.id}) FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" IN (SELECT "propertyId" FROM "Job" WHERE "id" = ${params.id}) FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "AiPhotoReview" WHERE "submissionId" IN (SELECT "id" FROM "FormSubmission" WHERE "jobId" = ${params.id}) FOR UPDATE`;
      // Recheck assignment inside the mutation transaction.
      if (session.user.role === Role.QA_INSPECTOR && !await tx.qaAssignment.findFirst({ where: { jobId: params.id, status: { not: "CANCELLED" }, ...qaAssignmentOwnerWhere(session.user.id) }, select: { id: true } })) throw new ReviewError("FORBIDDEN");
      const submission = await tx.formSubmission.findFirst({ where: { jobId: params.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { ...photoSubmissionInclude, aiPhotoReview: true } });
      if (!submission) throw new ReviewError("No submitted form is available.");
      const review = submission.aiPhotoReview;
      if (body.action === "analyze") {
        if (!config.comparisonEnabled) throw new ReviewError("Enable photo comparison in AI configuration first.");
        if (review?.reviewedAt) throw new ReviewError("This analysis already has a reviewer decision. A new form submission starts a new review.");
        if (review?.status === "RUNNING" && review.leaseUntil && review.leaseUntil > new Date()) throw new ReviewError("Analysis is already running.");
        return tx.aiPhotoReview.upsert({ where: { submissionId: submission.id }, create: { submissionId: submission.id, settings: config }, update: { settings: config, result: Prisma.DbNull, sourceFingerprint: null, status: "PENDING", attempts: 0, leaseToken: null, leaseUntil: null, error: null } });
      }
      if (!review || review.id !== body.analysisId) throw new ReviewError("The submitted form changed. Refresh the analysis.");
      if (review.reviewedAt) {
        const previous = review.decision as Record<string, unknown> | null;
        const sameFindings = body.action !== "approve" || JSON.stringify([...(previous?.findingIds as string[] ?? [])].sort()) === JSON.stringify(Array.from(new Set(body.findingIds)).sort());
        if (review.reviewedById !== session.user.id || previous?.action !== body.action || previous?.reason !== body.reason || !sameFindings) throw new ReviewError("This analysis already has a different reviewer decision.");
        return review;
      }
      if (review.status !== "READY") throw new ReviewError("Wait for photo analysis to finish.");
      if (review.sourceFingerprint !== photoSourceFingerprint(submission)) throw new ReviewError("Evidence changed. Request a fresh analysis before reviewing.");
      let decision: Record<string, unknown> = { action: body.action, reason: body.reason };
      if (body.action === "approve") {
        if (submission.job.status === "INVOICED") throw new ReviewError("Invoiced jobs cannot be adjusted here.");
        const settings = visionSettingsSchema.parse(review.settings);
        const findings = parsePhotoReviewResult(review.result).observations.flatMap(item => item.findings);
        if (body.findingIds.some(id => !findings.some(finding => finding.id === id))) throw new ReviewError("One or more selected findings are unavailable.");
        const deduction = proposedPhotoDeduction(findings, body.findingIds, settings.minConfidence, settings.maxScoreContribution);
        if (deduction <= 0) throw new ReviewError("Select an eligible finding, or dismiss the suggestions.");
        const scoreReview = authoritative(await tx.qAReview.findMany({ where: { jobId: params.id } }));
        if (!scoreReview || scoreReview.id !== body.expectedReviewId || scoreReview.score !== body.expectedScore) throw new ReviewError("The QA score changed. Refresh and review the deduction again.");
        if (session.user.role === Role.QA_INSPECTOR && (scoreReview.kind !== "QA" || scoreReview.reviewedById !== session.user.id)) throw new ReviewError("FORBIDDEN");
        const previousDeduction = await tx.aiPhotoReview.findFirst({ where: {
          id: { not: review.id }, reviewedAt: { not: null }, submission: { jobId: params.id },
          decision: { path: ["qaReviewId"], equals: scoreReview.id },
        }, select: { id: true } });
        if (previousDeduction) throw new ReviewError("This QA review already includes an approved photo deduction. Complete a new QA review or adjust it through the existing QA workflow.");
        const selected = findings.filter(finding => body.findingIds.includes(finding.id));
        const existingIssue = await tx.qaIssue.findFirst({ where: { qaReviewId: scoreReview.id, OR: [
          { fieldId: { in: Array.from(new Set(selected.map(finding => finding.fieldId))) } },
          ...Array.from(new Set(selected.map(finding => finding.mediaId))).map(mediaId => ({ cleanerMediaIds: { array_contains: [mediaId] } })),
        ] }, select: { id: true } });
        if (existingIssue) throw new ReviewError("A selected area or photo is already covered by a QA issue. Review that issue in the existing QA workflow to avoid deducting twice.");
        const score = Math.max(0, Math.round((scoreReview.score - deduction) * 100) / 100);
        const critical = await tx.qaIssue.count({ where: { qaReviewId: scoreReview.id, severity: "CRITICAL" } });
        const managementReview = critical > 0 && appSettings.accountability.scoring.criticalTriggersManagementReview;
        const rating = ratingForScore(score, appSettings.accountability.scoring, managementReview);
        const changed = await tx.qAReview.updateMany({ where: { id: scoreReview.id, score: body.expectedScore, updatedAt: scoreReview.updatedAt }, data: { score, rawScore: scoreReview.rawScore ?? scoreReview.score, rating, passed: rating === "EXCELLENT" || rating === "PASS", managementReview, adjustmentReason: `Approved photo findings: ${body.reason}`, editedById: session.user.id, editedAt: new Date() } });
        if (!changed.count) throw new ReviewError("The QA score changed. Refresh before applying.");
        const passed = rating === "EXCELLENT" || rating === "PASS";
        await tx.job.update({ where: { id: params.id }, data: { status: passed ? "COMPLETED" : "QA_REVIEW", completedAt: passed ? submission.job.completedAt ?? new Date() : null } });
        decision = { ...decision, findingIds: Array.from(new Set(body.findingIds)), deduction, scoreBefore: scoreReview.score, scoreAfter: score, qaReviewId: scoreReview.id };
      }
      const updated = await tx.aiPhotoReview.update({ where: { id: review.id }, data: { reviewedAt: new Date(), reviewedById: session.user.id, decision: decision as any } });
      await tx.auditLog.create({ data: { userId: session.user.id, jobId: params.id, action: "AI_PHOTO_REVIEW_DECISION", entity: "AiPhotoReview", entityId: review.id, after: decision as any } });
      return updated;
    });
    return NextResponse.json({ ok: true, review: result }, { headers });
  } catch (error) { return failure(error); }
}
