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
import { queueClientPostJobAutomations } from "@/lib/notifications/client-automation";
import {
  JobStatus,
  MediaType,
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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const { outcome: laundryOutcome, legacyReady } = normalizeLaundrySubmission(body);
    const laundrySkipReasonCode = body.laundrySkipReasonCode?.trim();
    const laundrySkipReasonNote = body.laundrySkipReasonNote?.trim();

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
    if (!template || !template.isActive) {
      return NextResponse.json({ error: "Selected form template is not available." }, { status: 400 });
    }

    const answers = (body.data ?? {}) as Record<string, unknown>;
    const jobMeta = parseJobInternalNotes(job.internalNotes);
    const unifiedJobTasks = await listCleanerJobTasks(job.id);
    const hasUnifiedAdminTasks = unifiedJobTasks.some((task) => task.source === "ADMIN");
    const hasUnifiedCarryForwardTasks = unifiedJobTasks.some((task) => task.source === "CARRY_FORWARD");
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
      template.schema,
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
    const missingRequiredSignatures = collectRequiredAnswerFields(
      template.schema,
      answers,
      (job.property ?? {}) as Record<string, unknown>,
      {
        laundryReady: legacyReady,
        fieldTypes: ["signature"],
      }
    );
    if (missingRequiredSignatures.length > 0) {
      const missingSignatureSummary = missingRequiredSignatures
        .map((field) =>
          field.sectionLabel && field.sectionLabel !== field.label
            ? `${field.sectionLabel}: ${field.label}`
            : field.label
        )
        .join(", ");
      return NextResponse.json(
        {
          error: `Missing required signatures: ${missingSignatureSummary}`,
          missingRequiredFields: missingRequiredSignatures,
        },
        { status: 400 }
      );
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

    const submission = await db.formSubmission.create({
      data: {
        jobId: params.id,
        templateId: body.templateId,
        submittedById: session.user.id,
        data: {
          ...(body.data as Record<string, unknown>),
          __templateSchema: template.schema,
          __templateVersion: template.id,
          __adminRequestedTasks: adminRequestedTasks,
          __jobTasks: unifiedTaskSnapshot,
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

    const inventoryUsage = sanitizeInventoryUsage(body.data as Record<string, unknown>);
    if (inventoryUsage && job.property.inventoryEnabled) {
      await deductStockFromSubmission(job.propertyId, submission.id, inventoryUsage);
    }

    if (carryForward && !hasUnifiedCarryForwardTasks) {
      if (carryForward.resolvedTaskIds.length > 0) {
        await db.issueTicket.updateMany({
          where: {
            id: { in: carryForward.resolvedTaskIds },
            title: { startsWith: "Carry-forward task" },
            status: { not: "RESOLVED" },
            job: { propertyId: job.propertyId },
          },
          data: {
            status: "RESOLVED",
            updatedAt: new Date(),
          },
        });
      }

      if (carryForward.hasNew && carryForward.newTaskNotes.length > 0) {
        await db.issueTicket.createMany({
          data: carryForward.newTaskNotes.map((note) => ({
            jobId: job.id,
            title: "Carry-forward task",
            description: note,
            severity: "HIGH",
            status: "OPEN",
          })),
        });
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

    if (body.draftDamagePayload?.title?.trim()) {
      const createdCase = await createCase({
        title: `Damage: ${body.draftDamagePayload.title.trim()}`,
        description: body.draftDamagePayload.description?.trim() || "",
        severity: body.draftDamagePayload.severity ?? "HIGH",
        status: "OPEN",
        caseType: "DAMAGE",
        source: "CLEANER_SUBMIT",
        jobId: job.id,
        clientId: job.property.clientId,
        propertyId: job.propertyId,
        clientVisible: true,
        clientCanReply: true,
        metadata: {
          estimatedCost: body.draftDamagePayload.estimatedCost ?? null,
          tags: ["damage", "submission"],
        },
        comment: {
          authorUserId: session.user.id,
          body: body.draftDamagePayload.description?.trim() || body.draftDamagePayload.title.trim(),
          isInternal: false,
        },
        attachments: (body.draftDamagePayload.mediaKeys ?? []).map((key) => ({
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

    if (
      body.draftPayRequestPayload?.requestedAmount != null &&
      Number(body.draftPayRequestPayload.requestedAmount) > 0
    ) {
      await db.cleanerPayAdjustment.create({
        data: {
          jobId: job.id,
          propertyId: job.propertyId,
          cleanerId: session.user.id,
          scope: "JOB",
          title: body.draftPayRequestPayload.title?.trim() || "Extra payment request",
          type: body.draftPayRequestPayload.type === "HOURLY" ? "HOURLY" : "FIXED",
          requestedHours:
            body.draftPayRequestPayload.requestedHours != null
              ? Number(body.draftPayRequestPayload.requestedHours)
              : null,
          requestedRate:
            body.draftPayRequestPayload.requestedRate != null
              ? Number(body.draftPayRequestPayload.requestedRate)
              : null,
          requestedAmount: Number(body.draftPayRequestPayload.requestedAmount),
          cleanerNote:
            body.draftPayRequestPayload.cleanerNote?.trim() ||
            body.draftPayRequestPayload.title?.trim() ||
            null,
          attachmentKeys:
            body.draftPayRequestPayload.mediaKeys && body.draftPayRequestPayload.mediaKeys.length > 0
              ? (body.draftPayRequestPayload.mediaKeys as any)
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
      data: { status: JobStatus.SUBMITTED },
    });

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

    generateJobReport(params.id).catch(console.error);
    await clearSharedCleanerJobDraft(params.id);

    return NextResponse.json({ ok: true, submissionId: submission.id });
  } catch (err: any) {
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
