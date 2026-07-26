import { NextRequest, NextResponse } from "next/server";
import { JobStatus, LaundryStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { getJobReference } from "@/lib/jobs/job-number";
import {
  normalizeJobResetOptions,
  planJobReset,
  startArtifactResetFields,
  type JobResetContext,
} from "@/lib/jobs/job-reset";

/**
 * Option-driven job reset (the rich "Reset job" dialog on the admin job page).
 *
 * The DEFAULT — and the only thing that runs unless the admin ticks more — is a
 * status-only reset: the job goes back to ASSIGNED and every job-level
 * start/progress marker is cleared, while time logs, assignees, submitted forms,
 * photos, QA and pay stay exactly as they are.
 *
 * GET returns the context the dialog needs to preview the reset (counts + the
 * guard state), so the dialog and this route plan from the same numbers via the
 * shared pure helper in lib/jobs/job-reset.ts.
 */

async function loadContext(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      payrollRunId: true,
      cleanerPaidAt: true,
      property: { select: { name: true, suburb: true } },
      assignments: {
        where: { removedAt: null },
        select: { user: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } } },
      },
      _count: { select: { timeLogs: true, formSubmissions: true, qaReviews: true, invoiceLines: true } },
      laundryTask: { select: { id: true } },
    },
  });
  if (!job) return null;

  const photoCount = await db.submissionMedia.count({ where: { submission: { jobId } } });

  const context: JobResetContext = {
    status: job.status,
    payrollRunId: job.payrollRunId,
    cleanerPaidAt: job.cleanerPaidAt,
    timeLogCount: job._count.timeLogs,
    assigneeCount: job.assignments.length,
    submissionCount: job._count.formSubmissions,
    photoCount,
    qaReviewCount: job._count.qaReviews,
    hasLaundryTask: Boolean(job.laundryTask),
    invoicedLineCount: job._count.invoiceLines,
  };
  return { job, context };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const loaded = await loadContext(params.id);
    if (!loaded) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ context: loaded.context });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const options = normalizeJobResetOptions(body.options);

    const loaded = await loadContext(params.id);
    if (!loaded) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const { job, context } = loaded;

    const plan = planJobReset(options, context);
    if (!plan.allowed) {
      return NextResponse.json(
        { error: plan.blockedReason ?? "This job cannot be reset.", code: "JOB_RESET_BLOCKED" },
        { status: 409 }
      );
    }
    if (plan.requiresExtraConfirm && body.confirmProtected !== true) {
      return NextResponse.json(
        {
          code: "JOB_RESET_CONFIRM_REQUIRED",
          error:
            "This job is completed or its pay is committed — confirm explicitly that you want to reset it.",
        },
        { status: 409 }
      );
    }
    // Anything that destroys records requires a PIN/password, same bar as the
    // full reset and delete actions. A status-only reset does not.
    if (plan.destructive) {
      await verifySensitiveAction(session.user.id, (body?.security ?? null) as any);
    }

    // Cleaners to notify (captured BEFORE any unassign runs).
    const affectedCleaners = job.assignments
      .map((a) => a.user)
      .filter((u): u is NonNullable<typeof u> => Boolean(u?.id && u.isActive));

    const applied = {
      status: job.status as string,
      targetStatus: plan.targetStatus,
      clearedStartArtifacts: true,
      deletedTimeLogs: 0,
      deletedSubmissions: 0,
      deletedPhotos: 0,
      restoredStockTransactions: 0,
      removedAssignments: 0,
      deletedQaReviews: 0,
      resetLaundryTask: false,
    };

    await db.$transaction(async (tx) => {
      const keys = new Set(plan.mutations.map((m) => m.key));

      if (keys.has("formData")) {
        // Put the stock the cleaner recorded as used back on the shelf, then
        // drop the submission, its media and its stock movements.
        const stockTxs = await tx.stockTx.findMany({
          where: { submission: { jobId: params.id } },
          select: { id: true, propertyStockId: true, quantity: true },
        });
        for (const stockTx of stockTxs) {
          await tx.propertyStock.update({
            where: { id: stockTx.propertyStockId },
            data: { onHand: { increment: Number((-stockTx.quantity).toFixed(2)) } },
          });
        }
        applied.restoredStockTransactions = stockTxs.length;
        await tx.stockTx.deleteMany({ where: { submission: { jobId: params.id } } });
        const media = await tx.submissionMedia.deleteMany({ where: { submission: { jobId: params.id } } });
        applied.deletedPhotos = media.count;
        // QA form submissions reference the cleaner submission's review chain —
        // detach before removing so the FK holds.
        await tx.qaFormSubmission.updateMany({ where: { jobId: params.id }, data: { qaReviewId: null } });
        const submissions = await tx.formSubmission.deleteMany({ where: { jobId: params.id } });
        applied.deletedSubmissions = submissions.count;
      }

      if (keys.has("qa")) {
        const reviews = await tx.qAReview.findMany({ where: { jobId: params.id }, select: { id: true } });
        const reviewIds = reviews.map((r) => r.id);
        if (reviewIds.length > 0) {
          await tx.qaFormSubmission.updateMany({
            where: { qaReviewId: { in: reviewIds } },
            data: { qaReviewId: null },
          });
          await tx.qAReview.deleteMany({ where: { id: { in: reviewIds } } });
          applied.deletedQaReviews = reviewIds.length;
        }
        await tx.qaAssignment.updateMany({
          where: { jobId: params.id },
          data: {
            status: QaAssignmentStatus.OPEN,
            assignedToId: null,
            pickedUpById: null,
            pickedUpAt: null,
            completedAt: null,
            onSiteStartedAt: null,
            onSiteEndedAt: null,
            onSiteMinutes: null,
          },
        });
      }

      if (keys.has("timeLogs")) {
        const logs = await tx.timeLog.deleteMany({ where: { jobId: params.id } });
        applied.deletedTimeLogs = logs.count;
      }

      if (keys.has("assignments")) {
        const removed = await tx.jobAssignment.updateMany({
          where: { jobId: params.id, removedAt: null },
          data: { removedAt: new Date(), isPrimary: false },
        });
        applied.removedAssignments = removed.count;
      }

      if (keys.has("laundry")) {
        await tx.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId: params.id } } });
        await tx.laundryTask.updateMany({
          where: { jobId: params.id },
          data: {
            status: LaundryStatus.PENDING,
            confirmedAt: null,
            pickedUpAt: null,
            droppedAt: null,
            flagReason: null,
            flagNotes: null,
            noPickupRequired: false,
            skipReasonCode: null,
            skipReasonNote: null,
            bagWeightKg: null,
            dropoffCostAud: null,
            receiptImageUrl: null,
            pickupKeyPhotoUrl: null,
            dropoffKeyPhotoUrl: null,
          },
        });
        applied.resetLaundryTask = true;
      }

      // Status + the start/progress artifacts — always, this is the whole point.
      await tx.job.update({
        where: { id: params.id },
        data: {
          ...startArtifactResetFields(),
          status: plan.targetStatus as JobStatus,
          actualHours: keys.has("timeLogs") ? null : undefined,
          completedAt: null,
          reminder24hSent: false,
          reminder2hSent: false,
        },
      });

      // ONE audit row listing exactly what this reset did.
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action: "JOB_RESET_OPTIONS",
          entity: "Job",
          entityId: params.id,
          before: { ...context, status: job.status } as any,
          after: { options, applied, summary: plan.summary } as any,
        },
      });
    });

    // Tell the affected cleaners when their own records were wiped — otherwise
    // they reopen the job and silently find their hours or photos gone.
    if (plan.notifyCleaners && affectedCleaners.length > 0) {
      const jobReference = getJobReference({ jobNumber: job.jobNumber, id: job.id });
      const propertyLabel = `${job.property?.name ?? "the property"}${job.property?.suburb ? ` (${job.property.suburb})` : ""}`;
      const cleared: string[] = [];
      if (applied.deletedTimeLogs > 0) cleared.push("your clock records");
      if (applied.deletedSubmissions > 0) cleared.push("the submitted form and photos");
      const clearedText = cleared.join(" and ") || "the job progress";
      const bodyText = `${jobReference} at ${propertyLabel} has been reset by admin — ${clearedText} were cleared. Please start the job again from your app.`;
      await deliverNotificationToRecipients({
        recipients: affectedCleaners,
        category: "jobs",
        jobId: params.id,
        web: { subject: "Job reset by admin", body: bodyText },
        email: {
          subject: "Job reset by admin",
          html: `<h2 style="margin:0 0 12px;">Job reset</h2><p>${bodyText}</p>`,
          logBody: bodyText,
        },
        sms: bodyText.slice(0, 320),
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true, applied, summary: plan.summary });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message ?? "Could not reset the job." }, { status });
  }
}
