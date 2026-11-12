import { NextRequest, NextResponse } from "next/server";
import { JobStatus, LaundryStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { verifySensitiveAction, type SensitiveActionCredentials, isSensitiveRefusal } from "@/lib/security/admin-verification";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { getJobReference } from "@/lib/jobs/job-number";
import { FINANCIAL_RECORD_LINE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import {
  normalizeJobResetOptions,
  planJobReset,
  startArtifactResetFields,
  type JobResetContext,
} from "@/lib/jobs/job-reset";
import {
  assertStockCountChoice,
  listAppliedStockCounts,
  parseAppliedCountChoice,
  resolveAppliedCountsOnReset,
  stockCountChoiceRequiredBody,
  StockCountChoiceRequiredError,
  type ResetCountResolution,
} from "@/lib/inventory/stock-count-reset";

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
 *
 * Applied stock counts (owner decision 2026-11-12): when a stock count from
 * this job's form was already applied to on-hand, GET lists it and POST
 * requires `appliedStockCounts: "REVERSE" | "KEEP"` (409
 * STOCK_COUNT_CHOICE_REQUIRED naming the counts otherwise). The choice is
 * carried out inside the reset transaction by lib/inventory/stock-count-reset.ts,
 * before "Clear form data" puts used stock back: a reversed count's item
 * returns to its pre-submission value; a kept (or not reversable) count's
 * item keeps its counted value, so its older usage rows are not added back on
 * top of it, and the count's ledger row is kept (detached from the deleted
 * submission) as the record that explains on-hand.
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
      // Lines on VOID invoices are not counted (owner decision 2026-11-11).
      _count: { select: { timeLogs: true, formSubmissions: true, qaReviews: true, invoiceLines: { where: FINANCIAL_RECORD_LINE_WHERE } } },
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
    const appliedStockCounts = await listAppliedStockCounts(db, params.id);
    return NextResponse.json({ context: loaded.context, appliedStockCounts });
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
    const stockCountChoice = parseAppliedCountChoice(body.appliedStockCounts);

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
    // Applied stock counts need an explicit choice; checked again inside the transaction.
    await assertStockCountChoice(db, params.id, stockCountChoice);
    // Anything that destroys records requires a PIN/password, same bar as the
    // full reset and delete actions. A status-only reset does not.
    if (plan.destructive) {
      await verifySensitiveAction(session.user.id, body?.security as SensitiveActionCredentials | undefined, "jobs.reset");
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
    let stockCounts: ResetCountResolution = { choice: stockCountChoice ?? "NONE", outcomes: [] };

    await db.$transaction(async (tx) => {
      const keys = new Set(plan.mutations.map((m) => m.key));

      // Counts already applied to on-hand: carry out the office's choice first.
      const countLedger = await tx.stockCountObservation.findMany({
        where: { jobId: params.id, stockTxId: { not: null } },
        select: { stockTxId: true, propertyId: true, itemId: true },
      });
      stockCounts = await resolveAppliedCountsOnReset(tx, {
        jobId: params.id,
        choice: stockCountChoice,
        actor: { id: session.user.id, role: session.user.role, impersonatedBy: session.impersonation?.actorId ?? null },
        path: "Reset job",
      });

      if (keys.has("formData")) {
        // The count ledger rows are history, not usage: keep them (detached
        // from the submission that is about to go) and never "restore" them.
        const countLedgerIds = countLedger.map((row) => row.stockTxId as string);
        // Items whose applied count stays in force keep their counted value;
        // the usage recorded before that count is already inside it.
        const countStillInForce = new Set(
          stockCounts.outcomes.filter((row) => row.outcome !== "REVERSED").map((row) => row.itemId),
        );
        if (countLedgerIds.length > 0) {
          await tx.stockTx.updateMany({ where: { id: { in: countLedgerIds } }, data: { submissionId: null } });
        }
        // Put the stock the cleaner recorded as used back on the shelf, then
        // drop the submission, its media and its stock movements.
        const stockTxs = await tx.stockTx.findMany({
          where: { submission: { jobId: params.id } },
          select: { id: true, propertyStockId: true, quantity: true, propertyStock: { select: { itemId: true } } },
        });
        for (const stockTx of stockTxs) {
          if (countStillInForce.has(stockTx.propertyStock.itemId)) continue;
          await tx.propertyStock.update({
            where: { id: stockTx.propertyStockId },
            data: { onHand: { increment: Number((-stockTx.quantity).toFixed(2)) } },
          });
          applied.restoredStockTransactions += 1;
        }
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
          after: { options, applied, summary: plan.summary, stockCounts, impersonatedBy: session.impersonation?.actorId ?? null } as any,
        },
      });
    });

    // Tell the affected cleaners when their own records were wiped — otherwise
    // they reopen the job and silently find their hours or photos gone.
    if (plan.notifyCleaners && affectedCleaners.length > 0) {
      const jobReference = getJobReference({ jobNumber: job.jobNumber, id: job.id });
      const propertyLabel = `${job.property?.name ?? "the property"}${job.property?.suburb ? ` (${job.property.suburb})` : ""}`;
      const wording = await loadNotificationWording("job.changed");
      const cleared: string[] = [];
      if (applied.deletedTimeLogs > 0) cleared.push(wording.line("cleared-clock", "INBOX", {}));
      if (applied.deletedSubmissions > 0) cleared.push(wording.line("cleared-form", "INBOX", {}));
      const clearedText = cleared.join(wording.line("cleared-joiner", "INBOX", {})) || wording.line("cleared-default", "INBOX", {});
      const values = { jobNumber: jobReference, propertyName: propertyLabel, clearedText };
      const inbox = wording.render("reset", "INBOX", values);
      const email = wording.render("reset", "EMAIL", values);
      const bodyText = inbox.body;
      await deliverNotificationToRecipients({
        recipients: affectedCleaners,
        category: "jobs",
        jobId: params.id,
        web: { subject: inbox.title, body: bodyText },
        email: {
          subject: email.subject,
          html: email.html,
          logBody: bodyText,
        },
        sms: wording.render("reset", "SMS", values).body.slice(0, 320),
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true, applied, summary: plan.summary, stockCounts });
  } catch (err: any) {
    if (err instanceof StockCountChoiceRequiredError) {
      return NextResponse.json(stockCountChoiceRequiredBody(err.counts), { status: 409 });
    }
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : isSensitiveRefusal(err)
            ? 423
            : 400;
    return NextResponse.json({ error: err.message ?? "Could not reset the job." }, { status });
  }
}
