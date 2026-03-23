import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { submitJobSchema } from "@/lib/validations/job";
import { deductStockFromSubmission } from "@/lib/inventory/stock";
import { generateJobReport } from "@/lib/reports/generator";
import { publicUrl } from "@/lib/s3";
import { sendEmail } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { ensureLaundryTaskForJob } from "@/lib/laundry/planner";
import { resolveAppUrl } from "@/lib/app-url";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { getJobReference } from "@/lib/jobs/job-number";
import { createCase } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";
import {
  JobStatus,
  LaundryStatus,
  MediaType,
  NotificationChannel,
  NotificationStatus,
  Role,
} from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

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

function valuesEqual(left: unknown, right: unknown) {
  if (typeof left === "boolean") return left === (right === true || right === "true");
  if (typeof left === "number") return left === Number(right);
  if (typeof right === "boolean") return (left === true || left === "true") === right;
  if (typeof right === "number") return Number(left) === right;
  return String(left ?? "") === String(right ?? "");
}

function isConditionMet(
  conditional: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
) {
  if (!conditional || typeof conditional !== "object") return true;

  if ("propertyField" in conditional) {
    return valuesEqual(property[conditional.propertyField], conditional.value);
  }

  if ("fieldId" in conditional) {
    const answerValue = answers[conditional.fieldId];
    if (answerValue === undefined && /laundry/i.test(String(conditional.fieldId))) {
      return valuesEqual(laundryReady, conditional.value);
    }
    return valuesEqual(answerValue, conditional.value);
  }

  return true;
}

function requiredUploadFieldIds(
  templateSchema: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
): string[] {
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const ids: string[] = [];

  for (const section of sections) {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const field of fields) {
      if (field?.type !== "upload" || !field?.required || !field?.id) continue;

      const conditional = field?.conditional;
      if (!isConditionMet(conditional, answers, property, laundryReady)) continue;

      ids.push(String(field.id));
    }
  }

  return ids;
}

async function notifyLaundryPartners(params: {
  propertyName: string;
  jobId: string;
  jobNumber: string;
  cleanDate: Date;
  pickupDate: Date;
  bagLocation: string;
  laundryPhotoUrl: string;
  portalUrl: string;
}) {
  const settings = await getAppSettings();
  const laundryUsers = await db.user.findMany({
    where: { role: Role.LAUNDRY, isActive: true },
    select: { id: true, name: true, email: true, phone: true },
  });
  const cleanDateLabel = format(
    toZonedTime(params.cleanDate, settings.timezone || "Australia/Sydney"),
    "EEEE, dd MMMM yyyy"
  );
  const pickupDateLabel = format(
    toZonedTime(params.pickupDate, settings.timezone || "Australia/Sydney"),
    "EEEE, dd MMMM yyyy"
  );
  const emailTemplate = renderEmailTemplate(settings, "laundryReady", {
    propertyName: params.propertyName,
    jobNumber: params.jobNumber,
    cleanDate: cleanDateLabel,
    scheduledPickupDate: pickupDateLabel,
    bagLocation: params.bagLocation,
    laundryPhotoUrl: params.laundryPhotoUrl,
    portalUrl: params.portalUrl,
    actionUrl: params.portalUrl,
    actionLabel: "Open laundry portal",
  });

  for (const user of laundryUsers) {
    if (user.email) {
      await sendEmail({
        to: user.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
      });
    }

    if (user.phone) {
      await sendSms(
        user.phone,
        `${params.jobNumber}: Laundry ready for ${params.propertyName} on ${cleanDateLabel}. Location: ${params.bagLocation}.`
      );
    }

    await db.notification.create({
      data: {
        userId: user.id,
        jobId: params.jobId,
        channel: NotificationChannel.EMAIL,
        subject: `Laundry ready - ${params.jobNumber}`,
        body: `${params.jobNumber} ready for pickup at ${params.propertyName} on ${cleanDateLabel}. Location: ${params.bagLocation}`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });
  }
}

async function alertAdminsLaundryNotReady(jobId: string, propertyName: string, jobNumber: string) {
  const adminUsers = await db.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });

  for (const admin of adminUsers) {
    await db.notification.create({
      data: {
        userId: admin.id,
        jobId,
        channel: NotificationChannel.EMAIL,
        subject: `Laundry not ready - ${jobNumber}`,
        body: `${jobNumber}: Cleaner submitted job for ${propertyName} with laundry_ready=NO. Laundry partner was not notified.`,
        status: NotificationStatus.PENDING,
      },
    });
  }
}

async function notifyLaundrySkipRequested(params: {
  jobId: string;
  propertyName: string;
  jobNumber: string;
  cleanDate: Date;
  laundryOutcome: "NOT_READY" | "NO_PICKUP_REQUIRED";
  reasonCode: string;
  reasonNote: string;
}) {
  const settings = await getAppSettings();
  const laundryUsers = await db.user.findMany({
    where: { role: Role.LAUNDRY, isActive: true },
    select: { id: true, email: true },
  });
  const cleanDateLabel = format(
    toZonedTime(params.cleanDate, settings.timezone || "Australia/Sydney"),
    "EEEE, dd MMMM yyyy"
  );
  const template = renderEmailTemplate(settings, "laundrySkipRequested", {
    propertyName: params.propertyName,
    jobNumber: params.jobNumber,
    cleanDate: cleanDateLabel,
    laundryOutcome: params.laundryOutcome.replace(/_/g, " "),
    reasonCode: params.reasonCode.replace(/_/g, " "),
    reasonNote: params.reasonNote,
    actionUrl: resolveAppUrl("/laundry"),
    actionLabel: "Open laundry portal",
  });

  for (const user of laundryUsers) {
    if (user.email) {
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
      });
    }

    await db.notification.create({
      data: {
        userId: user.id,
        jobId: params.jobId,
        channel: NotificationChannel.PUSH,
        subject: `Laundry update - ${params.jobNumber}`,
        body: `${params.jobNumber}: ${params.laundryOutcome.replace(/_/g, " ")} for ${params.propertyName}. ${params.reasonCode.replace(/_/g, " ")}${params.reasonNote ? ` - ${params.reasonNote}` : ""}`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });
  }
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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = submitJobSchema.parse(await req.json());

    const assignment = await db.jobAssignment.findUnique({
      where: { jobId_userId: { jobId: params.id, userId: session.user.id } },
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

    const template = await db.formTemplate.findUnique({
      where: { id: body.templateId },
      select: { id: true, schema: true, isActive: true },
    });
    if (!template || !template.isActive) {
      return NextResponse.json({ error: "Selected form template is not available." }, { status: 400 });
    }

    const answers = (body.data ?? {}) as Record<string, unknown>;
    const missingRequiredUploads = requiredUploadFieldIds(
      template.schema,
      answers,
      (job.property ?? {}) as Record<string, unknown>,
      legacyReady
    ).filter(
      (fieldId) => !uploads[fieldId] || uploads[fieldId].length === 0
    );
    if (missingRequiredUploads.length > 0) {
      return NextResponse.json(
        { error: `Missing required uploads: ${missingRequiredUploads.join(", ")}` },
        { status: 400 }
      );
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

    if (carryForward) {
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
      let laundryTask = await db.laundryTask.findUnique({
        where: { jobId: params.id },
      });
      if (!laundryTask) {
        laundryTask = await ensureLaundryTaskForJob(params.id);
      }
      if (!laundryTask) {
        const pickupDate = new Date(job.scheduledDate.getTime() + 24 * 60 * 60 * 1000);
        const dropoffDate = new Date(job.scheduledDate.getTime() + 48 * 60 * 60 * 1000);
        laundryTask = await db.laundryTask.create({
          data: {
            jobId: job.id,
            propertyId: job.propertyId,
            pickupDate,
            dropoffDate,
            status: LaundryStatus.PENDING,
          },
        });
      }

      if (laundryTask) {
        if (laundryOutcome === "READY_FOR_PICKUP") {
          const laundryPhotoUrl = publicUrl(laundryPhotoKey!);

          await db.laundryTask.update({
            where: { id: laundryTask.id },
            data: {
              status: LaundryStatus.CONFIRMED,
              notifyLaundry: true,
              noPickupRequired: false,
              skipReasonCode: null,
              skipReasonNote: null,
              adminOverrideNote: null,
              adminOverrideById: null,
              adminOverrideAt: null,
              confirmedAt: new Date(),
            },
          });

          await db.laundryConfirmation.create({
            data: {
              laundryTaskId: laundryTask.id,
              confirmedById: session.user.id,
              laundryReady: true,
              bagLocation,
              photoUrl: laundryPhotoUrl,
            },
          });

          await notifyLaundryPartners({
            propertyName: job.property.name,
            jobId: job.id,
            jobNumber: getJobReference(job),
            cleanDate: job.scheduledDate,
            pickupDate: laundryTask.pickupDate,
            bagLocation: bagLocation!,
            laundryPhotoUrl,
            portalUrl: resolveAppUrl("/laundry", req),
          });
        } else {
          const noPickupRequired = laundryOutcome === "NO_PICKUP_REQUIRED";
          await db.laundryTask.update({
            where: { id: laundryTask.id },
            data: {
              notifyLaundry: false,
              status: noPickupRequired ? LaundryStatus.SKIPPED_PICKUP : LaundryStatus.FLAGGED,
              noPickupRequired,
              skipReasonCode: laundrySkipReasonCode || null,
              skipReasonNote: laundrySkipReasonNote || null,
            },
          });

          await db.laundryConfirmation.create({
            data: {
              laundryTaskId: laundryTask.id,
              confirmedById: session.user.id,
              laundryReady: false,
              bagLocation,
              notes: [
                laundryOutcome.replace(/_/g, " "),
                laundrySkipReasonCode ? `Reason: ${laundrySkipReasonCode.replace(/_/g, " ")}` : "",
                laundrySkipReasonNote || "",
              ]
                .filter(Boolean)
                .join(" | "),
            },
          });

          await Promise.all([
            alertAdminsLaundryNotReady(job.id, job.property.name, getJobReference(job)),
            notifyLaundrySkipRequested({
              jobId: job.id,
              propertyName: job.property.name,
              jobNumber: getJobReference(job),
              cleanDate: job.scheduledDate,
              laundryOutcome,
              reasonCode: laundrySkipReasonCode || "OTHER",
              reasonNote: laundrySkipReasonNote || "",
            }),
          ]);
        }
      }
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
          cleanerId: session.user.id,
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
        },
      });
    }

    await db.job.update({
      where: { id: params.id },
      data: { status: JobStatus.SUBMITTED },
    });

    const openLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
    });
    if (openLog) {
      const now = new Date();
      await db.timeLog.update({
        where: { id: openLog.id },
        data: {
          stoppedAt: now,
          durationM: Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000),
        },
      });
    }

    generateJobReport(params.id).catch(console.error);

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
