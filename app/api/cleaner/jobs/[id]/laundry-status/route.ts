import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { cleanerLaundryStatusSchema } from "@/lib/validations/job";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";
import { resolveAppUrl } from "@/lib/app-url";
import { z } from "zod";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import { getSharedCleanerJobDraft, withSharedCleanerJobDraftLock } from "@/lib/cleaner/shared-job-draft";
import { earlyLaundryEvidenceConflict, isLaundryReceipt } from "@/lib/laundry/early-evidence";
import { getTransactionAppSettings } from "@/lib/settings";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { jobFormRevision } from "@/lib/forms/job-form-revision";
import { listCleanerJobTasks } from "@/lib/job-tasks/service";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { guestSummaryFromReservation, resolveFinalCheckupItems } from "@/lib/forms/final-checkup";

function normalizeLaundrySubmission(body: {
  laundryReady?: boolean;
  laundryOutcome?: "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
}) {
  return (
    body.laundryOutcome ??
    (body.laundryReady === true
      ? "READY_FOR_PICKUP"
      : body.laundryReady === false
        ? "NOT_READY"
        : undefined)
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = cleanerLaundryStatusSchema.extend({ formRevision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(await req.json());
    const laundryOutcome = normalizeLaundrySubmission(body);
    if (!laundryOutcome) {
      return NextResponse.json({ error: "Laundry outcome is required." }, { status: 400 });
    }

    const identity = cleanerDraftIdentity(session, params.id);
    const suppliedIdentity = req.headers.get("X-Cleaner-Draft-Identity");
    if (suppliedIdentity && suppliedIdentity !== identity) return NextResponse.json({ error: "Account changed. Reload this job." }, { status: 409 });
    const afterCommit: Array<() => Promise<void>> = [];
    const response = await withSharedCleanerJobDraftLock(params.id, async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${params.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "JobAssignment" WHERE "jobId" = ${params.id} ORDER BY "id" FOR SHARE`;
    const assignment = await tx.jobAssignment.findFirst({
      where: {
        jobId: params.id,
        userId: session.user.id,
        removedAt: null,
      },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }

    const job = await tx.job.findUnique({
      where: { id: params.id },
      include: { property: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${job.propertyId} FOR SHARE`;
    const property = await tx.property.findUnique({ where: { id: job.propertyId } });

    // Laundry only exists on Airbnb turnovers at laundry-enabled properties, and
    // never on reworks — the SAME shared predicate the submit route enforces
    // (lib/laundry/eligibility.ts), so this standalone endpoint stays
    // server-authoritative and can't pollute the laundry queue for a job that
    // should have no laundry task.
    if (!property || !isLaundryUpdateEligible(job, property)) {
      return NextResponse.json(
        { error: "This job has no laundry step." },
        { status: 400 }
      );
    }

    const lockedStatuses: JobStatus[] = [
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
      JobStatus.INVOICED,
    ];
    if (lockedStatuses.includes(job.status)) {
      return NextResponse.json({ error: "Job is already finished." }, { status: 400 });
    }

    const hasStartedLog = await tx.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id },
      select: { id: true },
    });
    if (!hasStartedLog) {
      return NextResponse.json(
        { error: "Start the job before sending laundry updates." },
        { status: 409 }
      );
    }

    const bagLocation = body.bagLocation?.trim();
    const laundrySkipReasonCode = body.laundrySkipReasonCode?.trim();
    const laundrySkipReasonNote = body.laundrySkipReasonNote?.trim();
    const laundryPhotoKey = body.laundryPhotoKey?.trim();

    if (laundryOutcome === "READY_FOR_PICKUP") {
      if (!bagLocation) {
        return NextResponse.json(
          { error: "Bag location is required when laundry is marked ready." },
          { status: 400 }
        );
      }
      if (!laundryPhotoKey) {
        return NextResponse.json(
          { error: "Laundry photo is required when laundry is marked ready." },
          { status: 400 }
        );
      }
    }

    if (
      (laundryOutcome === "NOT_READY" || laundryOutcome === "NO_PICKUP_REQUIRED") &&
      !laundrySkipReasonCode
    ) {
      return NextResponse.json(
        { error: "Select a reason when laundry is not ready or no pickup is required." },
        { status: 400 }
      );
    }

    const draft = await getSharedCleanerJobDraft(params.id, tx);
    const receipts = draft?.evidenceReceipts ?? {};
    const relevant = Object.values(receipts).filter(receipt => (!receipt.detached && isLaundryReceipt(receipt)) || receipt.key === laundryPhotoKey);
    if (relevant.length) {
      if (suppliedIdentity !== identity || earlyLaundryEvidenceConflict(receipts, { outcome: laundryOutcome, photoKey: laundryPhotoKey, formRevision: body.formRevision })) {
        return NextResponse.json({ error: "Laundry evidence changed. Reload or remove unused attachments before sending." }, { status: 409 });
      }
      await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = 'app' FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "FormTemplate" WHERE "serviceType"::text = ${job.jobType} ORDER BY "id" FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "JobTask" WHERE "jobId" = ${params.id} ORDER BY "id" FOR SHARE`;
      const settings = await getTransactionAppSettings(tx);
      const currentJob = { ...job, property };
      const effective = await resolveEffectiveJobForm(currentJob, settings, { database: tx });
      const tasks = await listCleanerJobTasks(job.id, tx);
      const meta = parseJobInternalNotes(job.internalNotes);
      const adminTasks = tasks.filter(task => task.source === "ADMIN");
      const finalCheckupItems = resolveFinalCheckupItems(settings, { jobType: job.jobType }, {
        guestSummary: guestSummaryFromReservation(meta.reservationContext),
        adminRequests: (adminTasks.length ? adminTasks : meta.specialRequestTasks ?? []).map(task => ({ id: String(task.id), title: String(task.title ?? "") })),
      });
      if (!effective.template || !effective.submittable || jobFormRevision({ template: effective.template, job: currentJob, settings, finalCheckupItems,
        canUseNoPhoto: settings.noPhotoExemptCleanerIds.includes(session.user.id) }) !== body.formRevision) {
        return NextResponse.json({ error: "The form changed. Reload before sending laundry evidence." }, { status: 409 });
      }
    }
    const result = await applyCleanerLaundryStatusUpdate({
      jobId: params.id,
      cleanerId: session.user.id,
      laundryOutcome,
      bagLocation,
      laundryPhotoKey,
      laundrySkipReasonCode,
      laundrySkipReasonNote,
      source: "EARLY_UPDATE",
      portalUrl: resolveAppUrl("/laundry", req),
    }, { transaction: tx, afterCommit });

    return NextResponse.json({
      ok: true,
      duplicated: result.duplicated,
      status: result.laundryTask?.status ?? null,
      updatedAt: result.laundryTask?.updatedAt ?? null,
    });
    });
    try {
      for (const notify of afterCommit) await notify();
    } catch {
      // The handoff is committed. A failed/partial provider attempt must not
      // turn it into a failed save or trigger an automatic duplicate delivery.
      return NextResponse.json({ ...(await response.json()), deliveryWarning: "Laundry update saved, but notification delivery could not be confirmed. Ask the office to review delivery before sending again." });
    }
    return response;
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
