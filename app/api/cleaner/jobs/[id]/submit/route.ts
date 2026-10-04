import { isDeviceStatusField, isDeviceAnswerComplete, incompleteDeviceExceptions } from "@/lib/forms/device-status";
import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { persistSubmissionPayRequestOnce } from "@/lib/cleaner/submission-pay";
import { deductJobStockOnce } from "@/lib/cleaner/submission-stock";
import { enqueueSubmissionFollowups, processSubmissionFollowups } from "@/lib/cleaner/submission-followups";
import { enqueuePhotoReview } from "@/lib/ai/photo-review";
import { enqueuePropertyModelTraining } from "@/lib/ai/property-model-training";
import { destinationOf, evidenceSubmissionChanged } from "@/lib/cleaner/evidence-destination";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ActionReceiptError, withCleanerAction } from "@/lib/cleaner/action-receipt";
import { submitJobSchema } from "@/lib/validations/job";
import { deductStockFromSubmission } from "@/lib/inventory/stock";
import { publicUrl } from "@/lib/s3";
import { resolveAppUrl } from "@/lib/app-url";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { createCase } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";
import { getAppSettings } from "@/lib/settings";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";
import {
  guestSummaryFromReservation,
  resolveFinalCheckupItems,
  validateFinalCheckupAck,
} from "@/lib/forms/final-checkup";
import { buildClockReview } from "@/lib/time/clock-rules";
import { sumRecordedTimeLogMinutes } from "@/lib/time/log-duration";
import { clearSharedCleanerJobDraft, getSharedCleanerJobDraft, withSharedCleanerJobDraftLock } from "@/lib/cleaner/shared-job-draft";
import { collectRequiredAnswerFields, collectRequiredUploadFields, flattenFieldsOneLevel } from "@/lib/forms/visibility";
import { collectUploadMinimumErrors } from "@/lib/forms/validate-submission";
import { sanitizeNoPhotoReasons } from "@/lib/forms/no-photo-reasons";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { jobFormRevision } from "@/lib/forms/job-form-revision";
import { jobFormProperty, UnsupportedFormPropertyConditionError } from "@/lib/forms/job-form-property";
import { applyCleanerJobTaskUpdates, listCleanerJobTasks } from "@/lib/job-tasks/service";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import { queueClientPostJobAutomations } from "@/lib/notifications/client-automation";
import { SELF_INSPECTION_MODULE_KEY } from "@/lib/checklists/catalog";
import {
  JobStatus,
  MediaType,
  NotificationChannel,
  NotificationStatus,
  Role,
  Prisma,
} from "@prisma/client";

function extractUploads(data: Record<string, unknown>): Record<string, string[]> {
  const uploads = (data as { uploads?: unknown }).uploads;
  if (!uploads || typeof uploads !== "object") return {};

  const normalized: Record<string, string[]> = {};
  for (const [fieldId, value] of Object.entries(uploads as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      normalized[fieldId] = [value.trim()];
      continue;
    }
    if (Array.isArray(value)) {
      const keys = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (keys.length > 0) {
        normalized[fieldId] = Array.from(new Set(keys));
      }
    }
  }
  return normalized;
}

function inferMediaType(fieldId: string, key: string): MediaType {
  if (fieldId.toLowerCase().includes("video")) return MediaType.VIDEO;
  if (/\.(mp4|mov|webm|m4v|avi)$/i.test(key)) return MediaType.VIDEO;
  return MediaType.PHOTO;
}

function normalizeLaundrySubmission(body: {
  laundryReady?: boolean;
  laundryOutcome?: "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
}) {
  const outcome =
    body.laundryOutcome ??
    (body.laundryReady === true
      ? "READY_FOR_PICKUP"
      : body.laundryReady === false
        ? "NOT_READY"
        : undefined);
  const legacyReady = outcome === "READY_FOR_PICKUP";
  return { outcome, legacyReady };
}

function sanitizeAdminRequestedTasks(
  data: Record<string, unknown>,
  uploads: Record<string, string[]>,
  configuredTasks: Array<{
    id: string;
    title: string;
    description?: string;
    requiresPhoto?: boolean;
    requiresNote?: boolean;
  }>
) {
  const raw = (data as { __adminRequestedTasks?: unknown }).__adminRequestedTasks;
  const submittedById = Array.isArray(raw)
    ? raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
  const submittedByTaskId = new Map<string, Record<string, unknown>>();
  for (const item of submittedById) {
    const taskId = typeof item.id === "string" ? item.id.trim() : "";
    if (!taskId) continue;
    submittedByTaskId.set(taskId, item);
  }

  return configuredTasks.map((task) => {
    const item = submittedByTaskId.get(task.id) ?? {};
    const photoFieldId =
      typeof item.photoFieldId === "string" && item.photoFieldId.trim()
        ? item.photoFieldId.trim()
        : `__admin_requested_task_${task.id}_photo`;
    const note = typeof item.note === "string" ? item.note.trim() : "";
    const completed =
      item.completed === true ||
      data[`__admin_requested_task_${task.id}_done`] === true;
    const photoKeys = Array.isArray(uploads[photoFieldId]) ? uploads[photoFieldId] : [];
    return {
      id: task.id,
      title: task.title,
      description: task.description?.trim() || "",
      requiresPhoto: task.requiresPhoto === true,
      requiresNote: task.requiresNote === true,
      completed,
      note,
      photoFieldId,
      photoKeys,
    };
  });
}

function unifiedJobTaskProofFieldId(taskId: string) {
  return `__job_task_${taskId}_proof`;
}

/**
 * The unticked final self-inspection checkboxes for a submission. Finds the
 * composed "final-inspection" section (section id === module key) in the schema
 * snapshot and returns every checkbox field not answered `true`. Legacy
 * templates without the section yield an empty list (no gate).
 */
function collectUntickedSelfInspection(
  schema: any,
  answers: Record<string, unknown>
): { id: string; label: string }[] {
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  const section = sections.find(
    (s: any) => typeof s?.id === "string" && s.id === SELF_INSPECTION_MODULE_KEY
  );
  if (!section || !Array.isArray(section.fields)) return [];
  const unticked: { id: string; label: string }[] = [];
  for (const field of section.fields) {
    if (!field || typeof field.id !== "string") continue;
    if (field.type && field.type !== "checkbox") continue;
    if (answers[field.id] === true || (isDeviceStatusField(field) && isDeviceAnswerComplete(answers[field.id]))) continue;
    unticked.push({
      id: field.id,
      label:
        typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.id,
    });
  }
  return unticked;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const rawBody = await req.json();
    const body = submitJobSchema.parse(rawBody);
    const globalDb = db;
    const afterCommit: Array<() => Promise<unknown>> = [];
    const deliveryAfterCommit: Array<() => Promise<void>> = [];
    const result = await withCleanerAction({ session, jobId: params.id, action: "submit", requestId: req.headers.get("X-Cleaner-Action-Id"), draftIdentity: req.headers.get("X-Cleaner-Draft-Identity"), body: rawBody }, async db => {
    const run = async () => {

    const assignment = await db.jobAssignment.findFirst({
      where: {
        jobId: params.id,
        userId: session.user.id,
        removedAt: null,
      },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }

    const job = await db.job.findUnique({
      where: { id: params.id },
      include: { property: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.cleanSkipStatus === "SKIPPED") return NextResponse.json({ error: "This clean has been skipped." }, { status: 409 });
    if (parseJobInternalNotes(job.internalNotes).isDraft) {
      return NextResponse.json({ error: "This job is a draft. Admin must publish it before submission." }, { status: 409 });
    }
    const pendingContinuationRequests = await listContinuationRequests({
      jobId: params.id,
      status: "PENDING",
    });
    if (pendingContinuationRequests.length > 0) {
      return NextResponse.json(
        {
          error:
            "A pause/continue request is pending admin decision. Submission is blocked until it is approved or rejected.",
        },
        { status: 409 }
      );
    }

    const uploads = extractUploads(body.data as Record<string, unknown>);
    const laundryPhotoKey = uploads["laundry_photo"]?.[0];
    const bagLocation = body.bagLocation?.trim();
    const carryForward = sanitizeCarryForward(body.data as Record<string, unknown>);
    // Laundry only exists on Airbnb turnovers. Rework/reclean jobs (and
    // laundry-disabled properties) never create a laundry booking or record a
    // laundry update — they reuse the original clean's linen. Shared predicate:
    // lib/laundry/eligibility.ts (also used by the laundry-status route + the
    // v2 cleaner workspace).
    const laundrySuppressed = !isLaundryUpdateEligible(job, job.property);
    const { outcome: rawLaundryOutcome, legacyReady: rawLegacyReady } = normalizeLaundrySubmission(body);
    const laundryOutcome = laundrySuppressed ? undefined : rawLaundryOutcome;
    const legacyReady = laundrySuppressed ? undefined : rawLegacyReady;
    const laundrySkipReasonCode = laundrySuppressed ? undefined : body.laundrySkipReasonCode?.trim();
    const laundrySkipReasonNote = laundrySuppressed ? undefined : body.laundrySkipReasonNote?.trim();

    const lockedStatuses: JobStatus[] = [
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
      JobStatus.INVOICED,
    ];
    if (lockedStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: "Job is already submitted/completed. Admin must reset status to allow another submission." },
        { status: 400 }
      );
    }

    const openLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
    });

    // Guard against submitting a job that was never actually started. Scoped
    // tightly so it can ONLY reject the genuinely-broken case and never touches
    // the normal (IN_PROGRESS / PAUSED) or clock-out-without-form (PAUSED +
    // formPendingAfterClockOut) flows: reject only when the job is still in a
    // pre-start status AND there is no open log, no prior TimeLog at all, and it
    // isn't parked as form-pending. Otherwise an OFFERED/ASSIGNED/EN_ROUTE job
    // could jump straight to SUBMITTED with zero recorded work time.
    const preStartStatuses: JobStatus[] = [
      JobStatus.UNASSIGNED,
      JobStatus.OFFERED,
      JobStatus.ASSIGNED,
      JobStatus.EN_ROUTE,
    ];
    if (
      preStartStatuses.includes(job.status) &&
      !openLog &&
      job.formPendingAfterClockOut !== true
    ) {
      const anyTimeLog = await db.timeLog.count({
        where: { jobId: params.id, userId: session.user.id },
      });
      if (anyTimeLog === 0) {
        return NextResponse.json(
          { error: "Start the job before submitting the form." },
          { status: 409 }
        );
      }
    }

    const priorTimeLogs = openLog
      ? await db.timeLog.findMany({
          where: {
            jobId: params.id,
            userId: session.user.id,
            id: { not: openLog.id },
            stoppedAt: { not: null },
          },
          select: {
            startedAt: true,
            stoppedAt: true,
            durationM: true,
          },
        })
      : [];
    const completedDurationMinutes = sumRecordedTimeLogMinutes(priorTimeLogs);
    if (body.clockAdjustmentRequest) {
      if (!openLog) {
        return NextResponse.json(
          { error: "There is no active clock running for this job." },
          { status: 400 }
        );
      }
      if (body.clockAdjustmentRequest.requestedDurationM <= completedDurationMinutes) {
        return NextResponse.json(
          {
            error:
              "Requested adjusted time must be greater than the time already recorded before this final clock segment.",
          },
          { status: 400 }
        );
      }
    }

    const appSettings = await getAppSettings();
    const effectiveForm = await resolveEffectiveJobForm(job, appSettings, { database: db });
    if (!effectiveForm.persistedTemplateId || !effectiveForm.template || body.templateId !== effectiveForm.persistedTemplateId) {
      return NextResponse.json({ code: "FORM_CHANGED", error: effectiveForm.submittable
        ? "The job form changed. Reload the form before submitting."
        : "No submittable form is available for this job. Contact the office." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    const template = effectiveForm.template;
    const persistedTemplateId = effectiveForm.persistedTemplateId;
    const jobMeta = parseJobInternalNotes(job.internalNotes);
    const effectiveSchema = template.schema;
    const usesRevisionContract = body.formContractVersion === 1 || body.formRevision !== undefined;
    const formProperty = usesRevisionContract ? jobFormProperty(effectiveSchema, job.property) : job.property;

    const answers = (body.data ?? {}) as Record<string, unknown>;
    const unifiedJobTasks = await listCleanerJobTasks(job.id, db);
    const hasUnifiedAdminTasks = unifiedJobTasks.some((task) => task.source === "ADMIN");
    const adminRequestedTasks = sanitizeAdminRequestedTasks(
      answers,
      uploads,
      hasUnifiedAdminTasks ? [] : jobMeta.specialRequestTasks ?? []
    );
    const submittedUnifiedTaskUpdates = Array.isArray(body.jobTasks) ? body.jobTasks : [];
    const unifiedTaskUpdatesById = new Map(submittedUnifiedTaskUpdates.map((task) => [task.id, task]));
    const unifiedTaskSnapshot = unifiedJobTasks.map((task) => {
      const update = unifiedTaskUpdatesById.get(task.id);
      return {
        id: task.id,
        title: task.title,
        description: task.description ?? "",
        source: task.source,
        approvalStatus: task.approvalStatus,
        decision: update?.decision ?? "OPEN",
        note: update?.note?.trim() || "",
        missingPhotoReason: update?.missingPhotoReason?.trim() || "",
        requiresPhoto: task.requiresPhoto === true,
        requiresNote: task.requiresNote === true,
        proofFieldId: unifiedJobTaskProofFieldId(String(task.id)),
        proofKeys: Array.isArray(update?.proofKeys) ? update.proofKeys : [],
      };
    });
    // "No photo taken" exemption: only cleaners the admin selected in settings
    // may waive an upload requirement, every waived field needs a valid coded
    // reason, and an actual upload always beats an excuse. The sanitized map is
    // the ONLY thing stored — an unearned or malformed entry never survives.
    const canUseNoPhoto = appSettings.noPhotoExemptCleanerIds.includes(session.user.id);
    // Final check-up gate (R7) — beside the self-inspection gate. Recompute the
    // acknowledgement items server-side (same resolver + same admin-request
    // source selection as the form read route) and require an ack for each.
    // Disabled/empty config resolves to [] → no gate.
    const finalCheckupAdminRequests = hasUnifiedAdminTasks
      ? unifiedJobTasks
          .filter((task) => task.source === "ADMIN")
          .map((task) => ({ id: String(task.id), title: String(task.title ?? "") }))
      : (jobMeta.specialRequestTasks ?? []).map((task) => ({
          id: String(task.id),
          title: String(task.title ?? ""),
        }));
    const finalCheckupItems = resolveFinalCheckupItems(
      appSettings,
      { jobType: job.jobType },
      {
        guestSummary: guestSummaryFromReservation(jobMeta.reservationContext),
        adminRequests: finalCheckupAdminRequests,
      }
    );
    let resolvedFormRevision: string | undefined;
    try {
      resolvedFormRevision = jobFormRevision({ template, job, settings: appSettings,
        canUseNoPhoto, finalCheckupItems });
    } catch (error) {
      if (usesRevisionContract || !(error instanceof UnsupportedFormPropertyConditionError)) throw error;
    }
    // Legacy callers continue during rollout. v2 explicitly opts into the
    // revision contract; any supplied revision is checked regardless of caller.
    if (usesRevisionContract &&
        body.formRevision !== resolvedFormRevision) {
      return NextResponse.json({ code: "FORM_CHANGED",
        error: "The job form changed. Your answers and evidence have been kept. Reload and review them before submitting." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    const noPhotoReasons = canUseNoPhoto
      ? Object.fromEntries(
          Object.entries(
            sanitizeNoPhotoReasons((answers as Record<string, unknown>).__noPhotoReasons)
          ).filter(([fieldId]) => !uploads[fieldId] || uploads[fieldId].length === 0)
        )
      : {};

    const missingRequiredUploads = collectRequiredUploadFields(
      effectiveSchema,
      answers,
      formProperty,
      legacyReady
    ).filter(
      (field) =>
        (!uploads[field.id] || uploads[field.id].length === 0) && !noPhotoReasons[field.id]
    );
    if (missingRequiredUploads.length > 0) {
      const missingUploadSummary = missingRequiredUploads
        .map((field) =>
          field.sectionLabel && field.sectionLabel !== field.label
            ? `${field.sectionLabel}: ${field.label}`
            : field.label
        )
        .join(", ");
      return NextResponse.json(
        {
          error: `Missing required uploads: ${missingUploadSummary}`,
          missingUploadFields: missingRequiredUploads,
        },
        { status: 400 }
      );
    }
    const uploadMinimumErrors = collectUploadMinimumErrors(
      effectiveSchema, answers,
      Object.fromEntries(Object.entries(uploads).map(([fieldId, keys]) => [fieldId, new Set(keys).size])),
      formProperty, legacyReady, { canUseNoPhoto, reasons: noPhotoReasons }
    );
    if (uploadMinimumErrors.length > 0) {
      return NextResponse.json({
        error: uploadMinimumErrors.map(field => `${field.label}: ${field.message}`).join("; "),
        missingUploadFields: uploadMinimumErrors.map(field => ({ ...field, id: field.fieldId })),
      }, { status: 400 });
    }

    // Enforce ALL required answerable fields (text, number, select, radio,
    // yes/no, rating, signature, etc.) — not just signatures. Upload fields are
    // skipped inside the collector (validated above). Previously only signatures
    // were enforced, so a required dropdown/number could be left blank.
    //
    // Whether an UNTICKED required checkbox blocks is the admin opt-in
    // `accountability.requiredChecklistTicksBlockSubmit` (default OFF — it makes
    // every generated checklist tick mandatory). The flag is handed to the same
    // pure helper the cleaner's client gate uses (it also receives it in the
    // GET /api/jobs/[id]/form payload), so the two can never disagree.
    const deviceErrors = incompleteDeviceExceptions(effectiveSchema, answers);
    if (deviceErrors.length) return NextResponse.json({ error: "Record a valid device status and a reason for each exception.", missingRequiredFields: deviceErrors }, { status: 400 });
    const submitGateSettings = appSettings.accountability;
    const missingRequiredAnswers = collectRequiredAnswerFields(
      effectiveSchema,
      answers,
      formProperty,
      {
        laundryReady: legacyReady,
        requiredChecklistTicksBlockSubmit:
          submitGateSettings.requiredChecklistTicksBlockSubmit === true,
      }
    );
    if (missingRequiredAnswers.length > 0) {
      const missingAnswerSummary = missingRequiredAnswers
        .map((field) =>
          field.sectionLabel && field.sectionLabel !== field.label
            ? `${field.sectionLabel}: ${field.label}`
            : field.label
        )
        .join(", ");
      return NextResponse.json(
        {
          error: `Please complete the required fields: ${missingAnswerSummary}`,
          missingRequiredFields: missingRequiredAnswers,
        },
        { status: 400 }
      );
    }
    // Final self-inspection gate (Accountability Phase 3). The 14 checkboxes are
    // required in the schema, but an unticked checkbox can arrive as `false`
    // (which the generic required-answer check treats as answered), so this is
    // the authoritative server gate. When settings.accountability
    // .selfInspectionBlocksSubmit is not explicitly false, reject with the list
    // of unticked labels; when it is off, accept but record the unticked keys
    // into the submission data for QA visibility.
    const untickedSelfInspection = collectUntickedSelfInspection(effectiveSchema, answers);
    let selfInspectionIncompleteKeys: string[] = [];
    if (untickedSelfInspection.length > 0) {
      if (submitGateSettings.selfInspectionBlocksSubmit !== false) {
        return NextResponse.json(
          {
            error: `Complete the final self-inspection: ${untickedSelfInspection
              .map((f) => f.label)
              .join(", ")}`,
            missingRequiredFields: untickedSelfInspection,
          },
          { status: 400 }
        );
      }
      selfInspectionIncompleteKeys = untickedSelfInspection.map((f) => f.id);
    }

    if (finalCheckupItems.length > 0) {
      const ackResult = validateFinalCheckupAck(finalCheckupItems, body.finalCheckupAck);
      if (!ackResult.ok) {
        const missingItems = finalCheckupItems.filter((item) =>
          ackResult.missingIds.includes(item.id)
        );
        return NextResponse.json(
          {
            error: "Complete the final check-up before submitting.",
            code: "FINAL_CHECKUP_REQUIRED",
            items: missingItems,
          },
          { status: 422 }
        );
      }
    }

    const incompleteAdminTask = adminRequestedTasks.find((task) => !task.completed);
    if (incompleteAdminTask) {
      return NextResponse.json(
        { error: `Admin requested task not completed: ${incompleteAdminTask.title}` },
        { status: 400 }
      );
    }
    const adminTaskMissingNote = adminRequestedTasks.find((task) => task.requiresNote && !task.note);
    if (adminTaskMissingNote) {
      return NextResponse.json(
        { error: `Cleaner note required for admin requested task: ${adminTaskMissingNote.title}` },
        { status: 400 }
      );
    }
    const adminTaskMissingPhoto = adminRequestedTasks.find(
      (task) => task.requiresPhoto && task.photoKeys.length === 0
    );
    if (adminTaskMissingPhoto) {
      return NextResponse.json(
        { error: `Image proof required for admin requested task: ${adminTaskMissingPhoto.title}` },
        { status: 400 }
      );
    }

    for (const task of unifiedJobTasks) {
      const update = unifiedTaskUpdatesById.get(task.id);
      if (!update) {
        return NextResponse.json(
          { error: `Complete or mark not completed for task: ${task.title}` },
          { status: 400 }
        );
      }
      const note = update.note?.trim() || "";
      const proofKeys = Array.isArray(update.proofKeys)
        ? update.proofKeys.filter((key) => typeof key === "string" && key.trim().length > 0)
        : [];
      if (update.decision === "NOT_APPLICABLE") {
        const metadata = task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
          ? task.metadata as Record<string, unknown> : {};
        if (metadata.allowNotApplicable !== true) {
          return NextResponse.json({ error: `This task cannot be marked not applicable: ${task.title}` }, { status: 400 });
        }
        if (!note || proofKeys.length === 0) {
          return NextResponse.json({ error: `Explain why this task is not applicable and attach photo proof: ${task.title}` }, { status: 400 });
        }
      }
      if (update.decision === "COMPLETED") {
        if (task.requiresNote && !note) {
          return NextResponse.json(
            { error: `Cleaner note required for task: ${task.title}` },
            { status: 400 }
          );
        }
        if (task.requiresPhoto && proofKeys.length === 0 && !update.missingPhotoReason?.trim()) {
          return NextResponse.json(
            { error: `Photo proof or a truthful missing-photo reason required for task: ${task.title}` },
            { status: 400 }
          );
        }
      } else if (!note) {
        return NextResponse.json(
          { error: `Reason required when task is not completed: ${task.title}` },
          { status: 400 }
        );
      }
    }

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

    // Carry-forward tasks are advisory in this workflow and must not block submission.

    // Claim, evidence snapshot and submission writes share the receipt transaction.
    const claimInput = {
      where: { id: params.id, status: { notIn: lockedStatuses } },
      data: { status: JobStatus.SUBMITTED },
    };
    const claim = await withSharedCleanerJobDraftLock(params.id, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${params.id} FOR UPDATE`;
      const draft = await getSharedCleanerJobDraft(params.id, tx);
      const receipts = draft?.evidenceReceipts ?? {};
      let currentTaskIds: Set<string> | null = null;
      if (Object.values(receipts).some(receipt => !receipt.detached && destinationOf(receipt).type === "jobTask")) {
        await tx.$queryRaw`SELECT "id" FROM "JobTask" WHERE "jobId" = ${params.id} ORDER BY "id" FOR SHARE`;
        currentTaskIds = new Set((await listCleanerJobTasks(params.id, tx)).map(task => task.id));
      }
      const unusedEvidence = Object.values(receipts).some(receipt => {
        if (receipt.detached) return false;
        const destination = destinationOf(receipt);
        return (destination.type === "laundry" && laundryOutcome !== "READY_FOR_PICKUP") ||
          (destination.type === "carryForwardNew" && (!carryForward?.hasNew || !carryForward.newTaskNotes.length)) ||
          (destination.type === "jobTask" && (!currentTaskIds?.has(destination.taskId) || !unifiedTaskSnapshot.some(task => task.id === destination.taskId && task.proofKeys.includes(receipt.key))));
      });
      const staleEvidence = unusedEvidence || evidenceSubmissionChanged(receipts, uploads, submittedUnifiedTaskUpdates, carryForward?.taskPhotoKeys ?? {});
      if (staleEvidence) return { count: -1 };
      return tx.job.updateMany(claimInput);
    }, db);
    if (claim.count === -1) return NextResponse.json({ code: "EVIDENCE_CHANGED",
      error: "Job evidence changed in another capture or tab. Reload and review attachments before submitting." }, { status: 409 });
    if (claim.count !== 1) {
      return NextResponse.json(
        { error: "This job was just submitted. Refresh to see the latest status." },
        { status: 409 }
      );
    }

    // Media, stock, clock and laundry persist atomically with the final receipt.
    const inventoryUsage = sanitizeInventoryUsage(body.data as Record<string, unknown>);
    let stockCorrectionRequired = false;
    const { submission, lowStockRows } = await (async (tx: Prisma.TransactionClient) => {
        const created = await tx.formSubmission.create({
          data: {
            jobId: params.id,
            templateId: persistedTemplateId,
            submittedById: session.user.id,
            data: {
              ...(body.data as Record<string, unknown>),
              __templateSchema: effectiveSchema,
              __rotationSections: effectiveForm.fullRotationSections,
              __templateVersion: template.id,
              __formRevision: resolvedFormRevision,
              __adminRequestedTasks: adminRequestedTasks,
              __jobTasks: unifiedTaskSnapshot,
              // Preserve the requests alongside the immutable submission for
              // reconciliation even when a downstream delivery fails.
              __submissionRequests: {
                damageItems: body.draftDamageItems ?? [], damage: body.draftDamagePayload ?? null,
                payItems: body.draftPayRequestItems ?? [], pay: body.draftPayRequestPayload ?? null,
                carryForward,
              },
              // Controlled system key: the server-sanctioned waivers only —
              // whatever the client sent under this key is overridden.
              __noPhotoReasons:
                Object.keys(noPhotoReasons).length > 0 ? noPhotoReasons : undefined,
              ...(selfInspectionIncompleteKeys.length > 0
                ? { __selfInspectionIncomplete: selfInspectionIncompleteKeys }
                : {}),
              ...(finalCheckupItems.length > 0
                ? {
                    __finalCheckup: {
                      items: finalCheckupItems,
                      acknowledgements: body.finalCheckupAck ?? [],
                    },
                  }
                : {}),
            } as any,
            laundryReady: laundryOutcome ? legacyReady : body.laundryReady,
            laundryOutcome,
            laundrySkipReasonCode,
            laundrySkipReasonNote,
            bagLocation,
          },
        });

        // Task proof was computed into a proofFieldId and then never stored
        // under it: submissionMedia rows are built from `uploads`, while the
        // proof arrives as jobTasks[].proofKeys. So the report's task section
        // looked for media nothing had ever written, and every photo a
        // cleaner took for a requested task was missing from the PDF.
        //
        // Merged only for the media rows, never back into `uploads` — the
        // required-photo validation above reads that, and a task photo must
        // not satisfy a form field's requirement.
        const mediaUploads: Record<string, string[]> = { ...uploads };
        for (const task of unifiedTaskSnapshot) {
          const keys = (task.proofKeys ?? []).filter(
            (key: unknown): key is string => typeof key === "string" && key.trim().length > 0
          );
          if (keys.length > 0) mediaUploads[task.proofFieldId] = keys;
        }

        if (Object.keys(mediaUploads).length > 0) {
          const mediaLabels = new Map<string, string>();
          for (const section of (effectiveSchema as any)?.sections ?? []) {
            for (const field of flattenFieldsOneLevel(section.fields)) {
              if (typeof field.id === "string" && typeof field.label === "string" && field.label.trim()) mediaLabels.set(field.id, field.label.trim());
            }
          }
          for (const task of unifiedTaskSnapshot) mediaLabels.set(task.proofFieldId, `${task.title} — proof`);
          for (const task of adminRequestedTasks) mediaLabels.set(task.photoFieldId, `${task.title} — proof`);
          const mediaRows = Object.entries(mediaUploads).flatMap(([fieldId, keys]) =>
            keys.map((key) => ({
              submissionId: created.id,
              fieldId,
              mediaType: inferMediaType(fieldId, key),
              url: publicUrl(key),
              s3Key: key,
              label: mediaLabels.get(fieldId) ?? fieldId.replace(/_/g, " "),
            }))
          );
          await tx.submissionMedia.createMany({ data: mediaRows });
        }

        await enqueuePhotoReview(created.id, tx);
        await enqueuePropertyModelTraining(job.propertyId, tx);

        let low: Awaited<ReturnType<typeof deductStockFromSubmission>>["lowStockRows"] = [];
        if (inventoryUsage && job.property.inventoryEnabled) {
          const stockResult = await deductJobStockOnce(tx, {
            jobId: job.id, propertyId: job.propertyId, submissionId: created.id, usage: inventoryUsage,
          });
          low = stockResult.lowStockRows;
          stockCorrectionRequired = stockResult.stockCorrectionRequired;
        }

        // Clear the "form pending after early clock-out" park flag inside the
        // same tx (status is already SUBMITTED from the atomic claim above).
        await tx.job.update({
          where: { id: params.id },
          data: { status: JobStatus.SUBMITTED, formPendingAfterClockOut: false },
        });

    if (laundryOutcome !== undefined) {
      await applyCleanerLaundryStatusUpdate({ jobId: job.id, cleanerId: session.user.id, laundryOutcome, bagLocation,
        laundryBagCount: body.laundryBagCount, laundryPhotoKey, laundrySkipReasonCode, laundrySkipReasonNote,
        source: "FINAL_SUBMISSION", portalUrl: resolveAppUrl("/laundry", req) }, { transaction: tx, afterCommit: deliveryAfterCommit });
    }
    if (openLog) {
      const review = buildClockReview({
        job: {
          scheduledDate: job.scheduledDate,
          dueTime: job.dueTime,
          endTime: job.endTime,
          estimatedHours: job.estimatedHours,
        },
        startedAt: openLog.startedAt,
        completedDurationMinutes,
        settings: appSettings,
      });
      const stoppedAt = review.suggestedStoppedAt;
      const durationM = review.cappedRunningDurationMinutes;

      await db.timeLog.update({
        where: { id: openLog.id },
        data: {
          stoppedAt,
          durationM,
        },
      });

      if (body.clockAdjustmentRequest) {
        const requestedDurationM = Number(body.clockAdjustmentRequest.requestedDurationM);
        if (Number.isFinite(requestedDurationM) && requestedDurationM > 0) {
          const requestedCurrentSegmentMinutes = Math.max(
            0,
            requestedDurationM - completedDurationMinutes
          );
          await db.timeLogAdjustmentRequest.create({
            data: {
              timeLogId: openLog.id,
              jobId: job.id,
              cleanerId: session.user.id,
              requestedDurationM,
              requestedStoppedAt: new Date(
                openLog.startedAt.getTime() + requestedCurrentSegmentMinutes * 60_000
              ),
              originalDurationM: durationM,
              originalStoppedAt: stoppedAt,
              reason: body.clockAdjustmentRequest.reason?.trim() || null,
            },
          });

          const adminUsers = await db.user.findMany({
            where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
            select: { id: true },
          });
          if (adminUsers.length > 0) {
            await db.notification.createMany({
              data: adminUsers.map((admin) => ({
                userId: admin.id,
                jobId: job.id,
                externalId: mobilePendingMarker("approvals"),
                channel: "PUSH",
                subject: "Clock adjustment approval needed",
                body: `${job.property.name}: ${session.user.name ?? session.user.email ?? "Cleaner"} requested a clock adjustment review.`,
                status: "SENT",
                sentAt: new Date(),
              })),
            });
          }
        }
      }
    }

        return { submission: created, lowStockRows: low };
      })(db);

    // Pay requests: same dual shape. Each committed request becomes a PENDING
    // CleanerPayAdjustment that lands in the admin pay-adjustments queue.
    const payRequestItems = [
      ...(Array.isArray(body.draftPayRequestItems) ? body.draftPayRequestItems : []),
      ...(body.draftPayRequestPayload ? [body.draftPayRequestPayload] : []),
    ].filter((item) => item && item.requestedAmount != null && Number(item.requestedAmount) > 0)
      .filter((item, index, items) => items.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(item)) === index);

    // Money requests are part of the submission transaction: never acknowledge
    // a submitted clean while silently dropping a requested payment.
    let payRequestsAlreadyRecorded = 0;
    for (const payRequest of payRequestItems) {
      const created = await persistSubmissionPayRequestOnce(db, { jobId: job.id, propertyId: job.propertyId,
        cleanerId: session.user.id, request: payRequest });
      if (!created) payRequestsAlreadyRecorded += 1;
    }


    // Damage items: accept both the new multi-item array and the legacy single
    // payload, dedupe, and open one DAMAGE case per committed item. Nothing the
    // cleaner added in the form is dropped.
    const damageItems = [
      ...(Array.isArray(body.draftDamageItems) ? body.draftDamageItems : []),
      ...(body.draftDamagePayload ? [body.draftDamagePayload] : []),
    ].filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
      .filter((item, index, items) => items.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(item)) === index);

    // Persist damage with the clean; maintenance and notifications run after commit.
    for (const damage of damageItems) {
      {
        const damageTitle = (damage.title ?? "").trim();
        if (!damageTitle) continue;
        const damageArea = damage.area?.trim();
        const damageBody = [
          damageArea ? `Area / room: ${damageArea}` : "",
          damage.description?.trim() || "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const createdCase = await createCase({
          title: `Damage: ${damageTitle}`,
          description: damageBody,
          severity: damage.severity ?? "HIGH",
          status: "OPEN",
          caseType: "DAMAGE",
          source: "CLEANER_SUBMIT",
          jobId: job.id,
          clientId: job.property.clientId,
          propertyId: job.propertyId,
          // Hidden until an admin review releases it. The client also reads
          // damage through the cases workspace, so leaving this true would let
          // damage reach them the moment a cleaner submitted — around the
          // report-level gate entirely (D1).
          clientVisible: false,
          clientCanReply: false,
          metadata: {
            estimatedCost: damage.estimatedCost ?? null,
            area: damageArea || null,
            tags: ["damage", "submission"],
          },
          comment: {
            authorUserId: session.user.id,
            body: damageBody || damageTitle,
            isInternal: false,
          },
          attachments: (damage.mediaKeys ?? []).map((key) => ({
            uploadedByUserId: session.user.id,
            s3Key: key,
          })),
        }, { transaction: db, afterCommit });
        if (createdCase) {
          afterCommit.push(() => notifyCaseCreated({
            caseItem: createdCase,
            actorLabel: session.user.name || session.user.email || "Cleaner",
          }));
        }
      }
    }


    // Carry-forward → the NEXT clean at this property. New flags become
    // CARRY_FORWARD JobTask rows (unified task system, mirroring
    // applyCleanerJobTaskUpdates) so they surface in the next job's checklist;
    // incoming carry-forward tasks the cleaner resolved are closed on both the
    // unified and legacy stores in the same transaction.
    if (carryForward) {
      {
        if (carryForward.resolvedTaskIds.length > 0) {
          await db.issueTicket.updateMany({
            where: {
              id: { in: carryForward.resolvedTaskIds },
              title: { startsWith: "Carry-forward task" },
              status: { not: "RESOLVED" },
              job: { propertyId: job.propertyId },
            },
            data: { status: "RESOLVED", updatedAt: new Date() },
          });
          await db.jobTask.updateMany({
            where: {
              id: { in: carryForward.resolvedTaskIds },
              jobId: job.id,
              source: "CARRY_FORWARD",
              executionStatus: "OPEN",
            },
            data: { executionStatus: "COMPLETED", completedAt: new Date() },
          });
        }

        if (carryForward.hasNew && carryForward.newTaskNotes.length > 0) {
          // The next non-finished clean at this property (>= this job's date). If
          // none exists yet, leave jobId null — attachPendingCarryForwardTasksToJob
          // (in the form route) attaches it to whichever clean is scheduled next.
          const nextJob = await db.job.findFirst({
            where: {
              propertyId: job.propertyId,
              status: { notIn: lockedStatuses },
              scheduledDate: { gte: job.scheduledDate },
              id: { not: job.id },
            },
            select: { id: true },
            orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
          });
          // New-flag photos are namespaced by the v2 workspace so they're never
          // confused with resolved-task proofs.
          const newFlagPhotoKeys = Array.isArray(carryForward.taskPhotoKeys.__carryForwardNew)
            ? carryForward.taskPhotoKeys.__carryForwardNew
            : [];
          for (const note of carryForward.newTaskNotes) {
            await db.jobTask.create({
              data: {
                jobId: nextJob?.id ?? null,
                propertyId: job.propertyId,
                clientId: job.property.clientId ?? null,
                source: "CARRY_FORWARD",
                approvalStatus: "APPROVED",
                executionStatus: "OPEN",
                visibleToCleaner: Boolean(nextJob?.id),
                title: "Flagged for next visit",
                description: note,
                requestedByUserId: session.user.id,
                approvedByUserId: session.user.id,
                approvedAt: new Date(),
                events: {
                  create: {
                    actorUserId: session.user.id,
                    action: "TASK_CARRIED_FORWARD",
                    note,
                  },
                },
                attachments: {
                  create: newFlagPhotoKeys
                    .filter((key) => typeof key === "string" && key.trim().length > 0)
                    .map((key) => ({
                      uploadedByUserId: session.user.id,
                      mediaType: inferMediaType("carry_forward_photo", key),
                      kind: "REQUEST_REFERENCE",
                      url: publicUrl(key),
                      s3Key: key,
                      label: "Flag for next clean",
                    })),
                },
              },
            });
          }
        }
      }
    }

    // Task decisions and any carry-forward rows are part of this submission.
    if (unifiedJobTasks.length > 0) {
      await applyCleanerJobTaskUpdates({
          jobId: job.id,
          propertyId: job.propertyId,
          clientId: job.property.clientId,
          cleanerId: session.user.id,
          taskUpdates: submittedUnifiedTaskUpdates.map((task) => ({
            id: task.id,
            decision: task.decision,
            note: task.note,
            proofKeys: task.proofKeys ?? [],
            missingPhotoReason: task.missingPhotoReason,
          })),
          baseUrl: req,
        }, { transaction: db, afterCommit });
    }


    await clearSharedCleanerJobDraft(params.id, db);
    await enqueueSubmissionFollowups(db, { jobId: job.id, submissionId: submission.id, propertyId: job.propertyId, lowStockRows });

    // This callback runs only after the submission and receipt have committed.
    afterCommit.push(async () => {
    const db = globalDb;


    // QA: as soon as the cleaner submits, open a QA assignment so an
    // inspector / ops / admin can claim it from the queue. Idempotent +
    // best-effort (never block submission on QA scaffolding failures).
    const followups = await processSubmissionFollowups(new Date(), submission.id);

    // Reclean summary: when a REWORK job is resubmitted, notify the QA who
    // flagged it (+ admins/ops) so they can review before vs after. Best-effort.
    if (job.isRework) {
      try {
        const afterAreas = Object.keys(uploads).filter((k) => k.startsWith("rework_area_")).length;
        const recipients = new Set<string>();
        if (job.reworkSourceReviewId) {
          const review = await db.qAReview.findUnique({
            where: { id: job.reworkSourceReviewId },
            select: { reviewedById: true },
          });
          if (review?.reviewedById) recipients.add(review.reviewedById);
        }
        const reviewers = await db.user.findMany({
          where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR] }, isActive: true },
          select: { id: true },
        });
        reviewers.forEach((u) => recipients.add(u.id));
        if (recipients.size > 0) {
          await db.notification.createMany({
            data: Array.from(recipients).map((userId) => ({
              userId,
              jobId: job.id,
              externalId: mobilePendingMarker("jobs"),
              channel: NotificationChannel.PUSH,
              subject: "Reclean submitted — ready to review",
              body: `${job.property.name}: the cleaner re-did ${afterAreas} flagged area(s) and uploaded after photos/videos. Review the before vs after.`,
              status: NotificationStatus.SENT,
              sentAt: new Date(),
            })),
          });
        }
      } catch (err) {
        console.error("[reclean-summary] notify failed", err);
      }
    }

    // Notify client that cleaning is complete (fire-and-forget)
    sendClientJobNotification({ jobId: params.id, type: "JOB_COMPLETE" });
    queueClientPostJobAutomations(params.id).catch(console.error);

    // Generate the report, then share it with the client (REPORT_READY) once it
    // exists. The "clean complete" email already fires via sendClientJobNotification
    // above, so we deliberately do NOT fire JOB_COMPLETED here (would duplicate) —
    // REPORT_READY is the new, distinct notification. Best-effort auto send.
    if (followups.reportReadySubmissionIds.includes(submission.id)) {
      await sendLifecycleEmail({ jobId: params.id, stage: "REPORT_READY", mode: "auto" });
    }

    return NextResponse.json({ ok: true, submissionId: submission.id, ...(stockCorrectionRequired ? { stockCorrectionRequired: true } : {}), ...(payRequestsAlreadyRecorded ? { payRequestsAlreadyRecorded } : {}) });
    });
    return NextResponse.json({ ok: true, submissionId: submission.id, ...(stockCorrectionRequired ? { stockCorrectionRequired: true } : {}), ...(payRequestsAlreadyRecorded ? { payRequestsAlreadyRecorded } : {}) });
    };
    const response = await run();
    return { status: response.status, body: await response.json() };
    });
    for (const complete of [...deliveryAfterCommit, ...afterCommit]) { try { await complete(); } catch (error) { console.error("[submit] post-commit follow-up failed", error); } }
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (err: any) {
    // The transaction already rolled back any incomplete mutation and receipt.
    const status = err instanceof ActionReceiptError ? err.status : err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
function sanitizeInventoryUsage(data: Record<string, unknown>): Record<string, number> | undefined {
  const usage = (data as { inventoryUsage?: unknown }).inventoryUsage;
  if (!usage || typeof usage !== "object") return undefined;

  const normalized: Record<string, number> = {};
  for (const [itemId, rawQty] of Object.entries(usage as Record<string, unknown>)) {
    const qty =
      typeof rawQty === "number"
        ? rawQty
        : typeof rawQty === "string"
          ? Number(rawQty)
          : NaN;
    if (Number.isFinite(qty) && qty > 0) {
      normalized[itemId] = qty;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function sanitizeCarryForward(data: Record<string, unknown>): {
  resolvedTaskIds: string[];
  hasNew: boolean;
  newTaskNotes: string[];
  taskPhotoKeys: Record<string, string[]>;
} | null {
  const raw = (data as { carryForward?: unknown }).carryForward;
  if (!raw || typeof raw !== "object") return null;

  const payload = raw as Record<string, unknown>;
  const resolvedTaskIds = Array.isArray(payload.resolvedTaskIds)
    ? payload.resolvedTaskIds
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

  const newTaskNotes = Array.isArray(payload.newTaskNotes)
    ? payload.newTaskNotes
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : typeof payload.newTaskNote === "string" && payload.newTaskNote.trim()
      ? [payload.newTaskNote.trim()]
      : [];

  const taskPhotoKeysRaw = payload.taskPhotoKeys;
  const taskPhotoKeys: Record<string, string[]> = {};
  if (taskPhotoKeysRaw && typeof taskPhotoKeysRaw === "object") {
    for (const [taskIdRaw, valuesRaw] of Object.entries(taskPhotoKeysRaw as Record<string, unknown>)) {
      const taskId = taskIdRaw.trim();
      if (!taskId) continue;
      const keys = Array.isArray(valuesRaw)
        ? valuesRaw
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      taskPhotoKeys[taskId] = Array.from(new Set(keys));
    }
  }

  return {
    resolvedTaskIds: Array.from(new Set(resolvedTaskIds)),
    hasNew: payload.hasNew === true,
    newTaskNotes: Array.from(new Set(newTaskNotes)),
    taskPhotoKeys,
  };
}
