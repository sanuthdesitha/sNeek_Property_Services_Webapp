import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { submitJobSchema } from "@/lib/validations/job";
import { deductStockFromSubmission } from "@/lib/inventory/stock";
import { generateJobReport } from "@/lib/reports/generator";
import { publicUrl } from "@/lib/s3";
import { resolveAppUrl } from "@/lib/app-url";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { createCase } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";
import { getAppSettings } from "@/lib/settings";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";
import { buildClockReview } from "@/lib/time/clock-rules";
import { sumRecordedTimeLogMinutes } from "@/lib/time/log-duration";
import { clearSharedCleanerJobDraft } from "@/lib/cleaner/shared-job-draft";
import { collectRequiredAnswerFields, collectRequiredUploadFields } from "@/lib/forms/visibility";
import { applyCleanerJobTaskUpdates, listCleanerJobTasks } from "@/lib/job-tasks/service";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import { queueClientPostJobAutomations } from "@/lib/notifications/client-automation";
import { tryEnsureQaAssignmentForCompletedJob } from "@/lib/qa/auto-assignment";
import { buildReworkFormSchema, normalizeReworkAreas } from "@/lib/qa/rework-jobs";
import { applyRotationCompletion, deriveRotationalCompletion } from "@/lib/accountability/rotation";
import { SELF_INSPECTION_MODULE_KEY } from "@/lib/checklists/catalog";
import {
  JobStatus,
  MediaType,
  NotificationChannel,
  NotificationStatus,
  Role,
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
        normalized[fieldId] = keys;
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
    if (answers[field.id] === true) continue;
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
  // When we atomically claim the SUBMITTED transition (below), remember the
  // status to roll back to if anything downstream throws, so a failed submit
  // never strands the job as SUBMITTED with no form. null = nothing to revert.
  let claimedFromStatus: JobStatus | null = null;
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = submitJobSchema.parse(await req.json());

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
    // Rework/reclean jobs (and laundry-disabled properties) never create a laundry
    // booking or record a laundry update — they reuse the original clean's linen.
    const laundrySuppressed = job.isRework || job.property.laundryEnabled === false;
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

    const template = await db.formTemplate.findUnique({
      where: { id: body.templateId },
      select: { id: true, schema: true, isActive: true },
    });
    // Rework jobs use a hidden (isActive=false) template row; the real checklist
    // is generated per-job from the QA-flagged areas, so accept it here.
    if (!template || (!template.isActive && !job.isRework)) {
      return NextResponse.json({ error: "Selected form template is not available." }, { status: 400 });
    }
    const reworkAreas = job.isRework ? normalizeReworkAreas(job.reworkAreas) : [];
    const effectiveSchema =
      job.isRework && reworkAreas.length > 0
        ? (buildReworkFormSchema(reworkAreas, {
            categorized: parseJobInternalNotes(job.internalNotes).reworkCategorized,
          }) as any)
        : template.schema;

    const answers = (body.data ?? {}) as Record<string, unknown>;
    const jobMeta = parseJobInternalNotes(job.internalNotes);
    const unifiedJobTasks = await listCleanerJobTasks(job.id);
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
        requiresPhoto: task.requiresPhoto === true,
        requiresNote: task.requiresNote === true,
        proofFieldId: unifiedJobTaskProofFieldId(String(task.id)),
        proofKeys: Array.isArray(update?.proofKeys) ? update.proofKeys : [],
      };
    });
    const missingRequiredUploads = collectRequiredUploadFields(
      effectiveSchema,
      answers,
      (job.property ?? {}) as Record<string, unknown>,
      legacyReady
    ).filter(
      (field) => !uploads[field.id] || uploads[field.id].length === 0
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
    // Enforce ALL required answerable fields (text, number, select, radio,
    // yes/no, rating, signature, etc.) — not just signatures. Upload fields are
    // skipped inside the collector (validated above). Previously only signatures
    // were enforced, so a required dropdown/number could be left blank.
    const missingRequiredAnswers = collectRequiredAnswerFields(
      effectiveSchema,
      answers,
      (job.property ?? {}) as Record<string, unknown>,
      { laundryReady: legacyReady }
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
      const accountabilitySettings = (await getAppSettings()).accountability;
      if (accountabilitySettings.selfInspectionBlocksSubmit !== false) {
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
      if (update.decision === "COMPLETED") {
        if (task.requiresNote && !note) {
          return NextResponse.json(
            { error: `Cleaner note required for task: ${task.title}` },
            { status: 400 }
          );
        }
        if (task.requiresPhoto && proofKeys.length === 0) {
          return NextResponse.json(
            { error: `Image proof required for task: ${task.title}` },
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

    // ATOMIC CLAIM — the idempotency point for the whole submission. All
    // validation above only reads/returns; everything below writes (form
    // submission, media, stock deduction, tasks, status). Transition the job to
    // SUBMITTED here, conditionally on it not already being in a locked state, so
    // two concurrent submits (double-tap / retry) can't both proceed — only the
    // one that actually flips the row (count === 1) continues; the loser gets a
    // 409 and does NO side effects (no duplicate submission, no double stock
    // deduction). If anything below throws, the outer catch reverts this claim.
    const claim = await db.job.updateMany({
      where: { id: params.id, status: { notIn: lockedStatuses } },
      data: { status: JobStatus.SUBMITTED },
    });
    if (claim.count !== 1) {
      return NextResponse.json(
        { error: "This job was just submitted. Refresh to see the latest status." },
        { status: 409 }
      );
    }
    claimedFromStatus = job.status;

    const submission = await db.formSubmission.create({
      data: {
        jobId: params.id,
        templateId: body.templateId,
        submittedById: session.user.id,
        data: {
          ...(body.data as Record<string, unknown>),
          __templateSchema: effectiveSchema,
          __templateVersion: template.id,
          __adminRequestedTasks: adminRequestedTasks,
          __jobTasks: unifiedTaskSnapshot,
          ...(selfInspectionIncompleteKeys.length > 0
            ? { __selfInspectionIncomplete: selfInspectionIncompleteKeys }
            : {}),
        } as any,
        laundryReady: laundryOutcome ? legacyReady : body.laundryReady,
        laundryOutcome,
        laundrySkipReasonCode,
        laundrySkipReasonNote,
        bagLocation,
      },
    });

    if (Object.keys(uploads).length > 0) {
      const mediaRows = Object.entries(uploads).flatMap(([fieldId, keys]) =>
        keys.map((key) => ({
          submissionId: submission.id,
          fieldId,
          mediaType: inferMediaType(fieldId, key),
          url: publicUrl(key),
          s3Key: key,
          label: fieldId.replace(/_/g, " "),
        }))
      );
      await db.submissionMedia.createMany({
        data: mediaRows,
      });
    }

    // Rotational-evidence state (Accountability Phase 3): reset completed
    // rotational items to 0 and advance the rest, atomically. Derived purely
    // from the submitted schema snapshot (ROTATIONAL fields) + answers + uploads.
    // Best-effort — a counter hiccup must never strand an otherwise-good submit.
    try {
      const { completedItemKeys, allRotationalItemKeys } = deriveRotationalCompletion(
        (effectiveSchema as any)?.sections,
        answers,
        uploads
      );
      if (allRotationalItemKeys.length > 0) {
        await db.$transaction((tx) =>
          applyRotationCompletion(tx, {
            propertyId: job.propertyId,
            jobId: job.id,
            completedItemKeys,
            allRotationalItemKeys,
          })
        );
      }
    } catch (rotationErr) {
      console.error("[rotation] state update failed", rotationErr);
    }

    const inventoryUsage = sanitizeInventoryUsage(body.data as Record<string, unknown>);
    if (inventoryUsage && job.property.inventoryEnabled) {
      await deductStockFromSubmission(job.propertyId, submission.id, inventoryUsage);
    }

    // Carry-forward → the NEXT clean at this property. New flags become
    // CARRY_FORWARD JobTask rows (unified task system, mirroring
    // applyCleanerJobTaskUpdates) so they surface in the next job's checklist;
    // incoming carry-forward tasks the cleaner resolved are closed on both the
    // unified and legacy stores. All best-effort — never block the submission.
    if (carryForward) {
      try {
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
      } catch (carryErr) {
        console.error("[carry-forward] persist failed", carryErr);
      }
    }

    if (laundryOutcome !== undefined) {
      await applyCleanerLaundryStatusUpdate({
        jobId: job.id,
        cleanerId: session.user.id,
        laundryOutcome,
        bagLocation,
        laundryPhotoKey,
        laundrySkipReasonCode,
        laundrySkipReasonNote,
        source: "FINAL_SUBMISSION",
        portalUrl: resolveAppUrl("/laundry", req),
      });
    }

    // Damage items: accept both the new multi-item array and the legacy single
    // payload, dedupe, and open one DAMAGE case per committed item. Nothing the
    // cleaner added in the form is dropped.
    const damageItems = [
      ...(Array.isArray(body.draftDamageItems) ? body.draftDamageItems : []),
      ...(body.draftDamagePayload ? [body.draftDamagePayload] : []),
    ].filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0);

    for (const damage of damageItems) {
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
        clientVisible: true,
        clientCanReply: true,
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
      });
      if (createdCase) {
        await notifyCaseCreated({
          caseItem: createdCase,
          actorLabel: session.user.name || session.user.email || "Cleaner",
        });
      }
    }

    // Pay requests: same dual shape. Each committed request becomes a PENDING
    // CleanerPayAdjustment that lands in the admin pay-adjustments queue.
    const payRequestItems = [
      ...(Array.isArray(body.draftPayRequestItems) ? body.draftPayRequestItems : []),
      ...(body.draftPayRequestPayload ? [body.draftPayRequestPayload] : []),
    ].filter((item) => item && item.requestedAmount != null && Number(item.requestedAmount) > 0);

    for (const payRequest of payRequestItems) {
      await db.cleanerPayAdjustment.create({
        data: {
          jobId: job.id,
          propertyId: job.propertyId,
          cleanerId: session.user.id,
          scope: "JOB",
          title: payRequest.title?.trim() || "Extra payment request",
          type: payRequest.type === "HOURLY" ? "HOURLY" : "FIXED",
          requestedHours:
            payRequest.requestedHours != null ? Number(payRequest.requestedHours) : null,
          requestedRate:
            payRequest.requestedRate != null ? Number(payRequest.requestedRate) : null,
          requestedAmount: Number(payRequest.requestedAmount),
          cleanerNote: payRequest.cleanerNote?.trim() || payRequest.title?.trim() || null,
          attachmentKeys:
            payRequest.mediaKeys && payRequest.mediaKeys.length > 0
              ? (payRequest.mediaKeys as any)
              : undefined,
        },
      });
    }

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
        })),
        baseUrl: req,
      });
    }

    await db.job.update({
      where: { id: params.id },
      // Clear the "form pending after early clock-out" park flag now the form is in.
      data: { status: JobStatus.SUBMITTED, formPendingAfterClockOut: false },
    });
    // The submission + stock deduction + status are now durably committed. From
    // here on the work is QA scaffolding / notifications / cleanup — a failure in
    // those must NOT revert the claim (the job really is submitted).
    claimedFromStatus = null;

    // QA: as soon as the cleaner submits, open a QA assignment so an
    // inspector / ops / admin can claim it from the queue. Idempotent +
    // best-effort (never block submission on QA scaffolding failures).
    await tryEnsureQaAssignmentForCompletedJob(params.id);

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

    if (openLog) {
      const settings = await getAppSettings();
      const review = buildClockReview({
        job: {
          scheduledDate: job.scheduledDate,
          dueTime: job.dueTime,
          endTime: job.endTime,
          estimatedHours: job.estimatedHours,
        },
        startedAt: openLog.startedAt,
        completedDurationMinutes,
        settings,
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

    // Notify client that cleaning is complete (fire-and-forget)
    sendClientJobNotification({ jobId: params.id, type: "JOB_COMPLETE" });
    queueClientPostJobAutomations(params.id).catch(console.error);

    // Generate the report, then share it with the client (REPORT_READY) once it
    // exists. The "clean complete" email already fires via sendClientJobNotification
    // above, so we deliberately do NOT fire JOB_COMPLETED here (would duplicate) —
    // REPORT_READY is the new, distinct notification. Best-effort auto send.
    generateJobReport(params.id)
      .then(() =>
        sendLifecycleEmail({ jobId: params.id, stage: "REPORT_READY", mode: "auto" })
      )
      .catch(console.error);
    await clearSharedCleanerJobDraft(params.id);

    return NextResponse.json({ ok: true, submissionId: submission.id });
  } catch (err: any) {
    // Roll back an in-flight SUBMITTED claim (only if the job is still SUBMITTED,
    // so a concurrent advance isn't clobbered) so a failed submit doesn't leave
    // the job stranded and un-retryable. Best-effort; never mask the real error.
    if (claimedFromStatus !== null) {
      await db.job
        .updateMany({
          where: { id: params.id, status: JobStatus.SUBMITTED },
          data: { status: claimedFromStatus },
        })
        .catch(() => {});
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
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
