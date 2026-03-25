import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateJobSchema } from "@/lib/validations/job";
import { Role, JobStatus } from "@prisma/client";
import { z } from "zod";
import {
  applyJobTimingRules,
  getJobTimingHighlights,
  parseJobInternalNotes,
  serializeJobInternalNotes,
} from "@/lib/jobs/meta";
import { classifyPriorityFromTimingRule } from "@/lib/jobs/priority";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { getAppSettings } from "@/lib/settings";
import { getJobReference } from "@/lib/jobs/job-number";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { getValidationErrorMessage } from "@/lib/validations/errors";

const CONTINUATION_KEY = "job_continuation_requests_v1";

function normalizeRule(
  rule:
    | {
        enabled?: boolean;
        preset?: "none" | "11:00" | "12:30" | "custom";
        time?: string;
      }
    | undefined
) {
  if (!rule) return undefined;
  return {
    enabled: rule.enabled === true,
    preset: rule.preset ?? "none",
    time: rule.time,
  };
}

function formatJobStatus(value: string | null | undefined) {
  return (value ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (part) => part.toUpperCase());
}

function formatJobDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "-";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const job = await db.job.findUnique({
      where: { id: params.id },
      include: {
        property: { include: { client: true, integration: true } },
        assignments: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true, role: true } },
          },
        },
        timeLogs: { include: { user: { select: { name: true } } } },
        formSubmissions: {
          include: {
            template: true,
            media: true,
            stockTxs: {
              include: {
                propertyStock: {
                  include: { item: true },
                },
              },
            },
            submittedBy: { select: { name: true } },
          },
        },
        qaReviews: true,
        laundryTask: true,
        report: true,
        issueTickets: true,
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      ...job,
      jobMeta: parseJobInternalNotes(job.internalNotes),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = updateJobSchema
      .extend({ confirmCompletedReset: z.boolean().optional() })
      .parse(await req.json());
    const { confirmCompletedReset, ...body } = parsed;
    const current = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        jobNumber: true,
        propertyId: true,
        jobType: true,
        status: true,
        internalNotes: true,
        startTime: true,
        dueTime: true,
        scheduledDate: true,
        property: { select: { name: true, suburb: true } },
        assignments: {
          where: { removedAt: null },
          select: {
            user: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } },
          },
        },
      },
    });
    if (!current) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (
      body.status === JobStatus.UNASSIGNED &&
      (current.status === JobStatus.COMPLETED || current.status === JobStatus.INVOICED) &&
      !confirmCompletedReset
    ) {
      return NextResponse.json(
        { error: "CONFIRM_COMPLETED_RESET_REQUIRED", message: "Confirm moving a completed job back to unassigned." },
        { status: 409 }
      );
    }

    const data: Record<string, unknown> = { ...body };
    const currentMeta = parseJobInternalNotes(current.internalNotes);
    const nextEarlyCheckin = normalizeRule(body.earlyCheckin) ?? currentMeta.earlyCheckin;
    const nextLateCheckout = normalizeRule(body.lateCheckout) ?? currentMeta.lateCheckout;
    if (body.scheduledDate) {
      data.scheduledDate = new Date(body.scheduledDate);
    }
    const hasMetaFields =
      body.internalNotes !== undefined ||
      body.isDraft !== undefined ||
      body.tags !== undefined ||
      body.attachments !== undefined ||
      body.specialRequestTasks !== undefined ||
      body.transportAllowances !== undefined ||
      body.earlyCheckin !== undefined ||
      body.lateCheckout !== undefined ||
      body.serviceContext !== undefined ||
      body.reservationContext !== undefined;
    if (hasMetaFields) {
      data.internalNotes = serializeJobInternalNotes({
        ...currentMeta,
        internalNoteText: body.internalNotes ?? currentMeta.internalNoteText,
        isDraft: body.isDraft ?? currentMeta.isDraft,
        tags: body.tags ?? currentMeta.tags,
        attachments: body.attachments ?? currentMeta.attachments,
        specialRequestTasks:
          body.specialRequestTasks?.map((task, index) => ({
            id: task.id?.trim() || `admin-task-${index + 1}`,
            title: task.title.trim(),
            description: task.description?.trim() || undefined,
            requiresPhoto: task.requiresPhoto === true,
            requiresNote: task.requiresNote === true,
          })) ?? currentMeta.specialRequestTasks,
        transportAllowances: body.transportAllowances ?? currentMeta.transportAllowances,
        earlyCheckin: nextEarlyCheckin,
        lateCheckout: nextLateCheckout,
        serviceContext: body.serviceContext ?? currentMeta.serviceContext,
        reservationContext: body.reservationContext ?? currentMeta.reservationContext,
      });
    }
    const shouldApplyTiming =
      hasMetaFields || body.startTime !== undefined || body.dueTime !== undefined;
    if (shouldApplyTiming) {
      const timing = applyJobTimingRules({
        startTime: body.startTime ?? current.startTime,
        dueTime: body.dueTime ?? current.dueTime,
        earlyCheckin: nextEarlyCheckin,
        lateCheckout: nextLateCheckout,
      });
      const priority = classifyPriorityFromTimingRule(nextEarlyCheckin);
      data.startTime = timing.startTime ?? null;
      data.dueTime = timing.dueTime ?? null;
      data.priorityBucket = priority.priorityBucket;
      data.priorityReason = priority.priorityReason;
      data.sameDayCheckin = priority.sameDayCheckin;
      data.sameDayCheckinTime = priority.sameDayCheckinTime;
    }
    delete data.isDraft;
    delete data.tags;
    delete data.attachments;
    delete data.specialRequestTasks;
    delete data.transportAllowances;
    delete data.earlyCheckin;
    delete data.lateCheckout;
    delete data.clientId;
    delete data.serviceSite;
    delete data.serviceContext;
    delete data.reservationContext;

    let job;
    if (body.status === JobStatus.UNASSIGNED) {
      job = await db.$transaction(async (tx) => {
        await tx.jobAssignment.deleteMany({ where: { jobId: params.id } });
        return tx.job.update({
          where: { id: params.id },
          data,
        });
      });
    } else {
      job = await db.job.update({
        where: { id: params.id },
        data,
      });
    }

    const refreshed = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        jobNumber: true,
        propertyId: true,
        jobType: true,
        status: true,
        internalNotes: true,
        startTime: true,
        dueTime: true,
        scheduledDate: true,
        property: { select: { name: true, suburb: true } },
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: "UPDATE_JOB",
        entity: "Job",
        entityId: params.id,
        after: data as any,
      },
    });

    if (refreshed) {
      const previousMeta = parseJobInternalNotes(current.internalNotes);
      const nextMeta = parseJobInternalNotes(refreshed.internalNotes);
      const previousTiming = getJobTimingHighlights(previousMeta).join(" | ");
      const nextTiming = getJobTimingHighlights(nextMeta).join(" | ");
      const changes: string[] = [];

      if (formatJobStatus(current.status) !== formatJobStatus(refreshed.status)) {
        changes.push(`Status: ${formatJobStatus(current.status)} -> ${formatJobStatus(refreshed.status)}`);
      }
      if (formatJobDate(current.scheduledDate) !== formatJobDate(refreshed.scheduledDate)) {
        changes.push(`Date: ${formatJobDate(current.scheduledDate)} -> ${formatJobDate(refreshed.scheduledDate)}`);
      }
      if ((current.startTime ?? "") !== (refreshed.startTime ?? "")) {
        changes.push(`Start time: ${current.startTime ?? "-"} -> ${refreshed.startTime ?? "-"}`);
      }
      if ((current.dueTime ?? "") !== (refreshed.dueTime ?? "")) {
        changes.push(`Finish time: ${current.dueTime ?? "-"} -> ${refreshed.dueTime ?? "-"}`);
      }
      if (previousTiming !== nextTiming) {
        changes.push(`Turnaround flags: ${nextTiming || "Cleared"}`);
      }
      if ((body.internalNotes ?? "").trim()) {
        changes.push("Job notes updated");
      }

      if (changes.length > 0) {
        const settings = await getAppSettings();
        const companyName = settings.companyName || "sNeek Property Services";
        const jobReference = getJobReference(refreshed);
        const propertyLabel = `${refreshed.property.name}${refreshed.property.suburb ? ` (${refreshed.property.suburb})` : ""}`;
        const immediateAttention =
          current.status !== refreshed.status ||
          formatJobDate(current.scheduledDate) !== formatJobDate(refreshed.scheduledDate) ||
          current.startTime !== refreshed.startTime ||
          current.dueTime !== refreshed.dueTime;
        const summaryLines = changes.map((row) => `<li>${row}</li>`).join("");
        const emailHtml = `
          <h2 style="margin:0 0 12px;">Job updated${immediateAttention ? " - immediate attention" : ""}</h2>
          <p><strong>${jobReference}</strong> for <strong>${propertyLabel}</strong> has been updated.</p>
          <ul style="padding-left:18px;margin:12px 0;">${summaryLines}</ul>
          <p>Open the job for the latest instructions and schedule details.</p>
        `;
        const notificationTemplate = renderNotificationTemplate(settings, "jobUpdated", {
          jobNumber: jobReference,
          propertyName: propertyLabel,
          changeSummary: changes.join(" | "),
          immediateAttention: immediateAttention ? "Immediate attention required. " : "",
        });
        const webSubject = `${companyName}: ${notificationTemplate.webSubject}`;
        const webBody = notificationTemplate.webBody;
        const smsBody = notificationTemplate.smsBody.slice(0, 320);

        const cleaners = current.assignments
          .map((assignment) => assignment.user)
          .filter((user): user is NonNullable<typeof current.assignments[number]["user"]> => Boolean(user?.id && user.isActive));
        if (cleaners.length > 0) {
          await deliverNotificationToRecipients({
            recipients: cleaners,
            category: "jobs",
            jobId: refreshed.id,
            web: { subject: webSubject, body: webBody },
            email: {
              subject: webSubject,
              html: emailHtml,
              logBody: webBody,
            },
            sms: smsBody,
          });
        }

      }
    }

    return NextResponse.json(job);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not update job.") }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
    const jobId = params.id;

    const existing = await db.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      await tx.stockTx.deleteMany({ where: { submission: { jobId } } });
      await tx.submissionMedia.deleteMany({ where: { submission: { jobId } } });
      await tx.formSubmission.deleteMany({ where: { jobId } });
      await tx.timeLog.deleteMany({ where: { jobId } });
      await tx.jobAssignment.deleteMany({ where: { jobId } });
      await tx.qAReview.deleteMany({ where: { jobId } });
      await tx.issueTicket.deleteMany({ where: { jobId } });
      await tx.report.deleteMany({ where: { jobId } });
      await tx.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId } } });
      await tx.laundryTask.deleteMany({ where: { jobId } });
      await tx.auditLog.deleteMany({ where: { jobId } });
      await tx.job.delete({ where: { id: jobId } });
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE_JOB",
        entity: "Job",
        entityId: jobId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
    const jobId = params.id;

    const existing = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        propertyId: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const stockTxs = await db.stockTx.findMany({
      where: { submission: { jobId } },
      select: { id: true, propertyStockId: true, quantity: true },
    });

    const continuationSetting = await db.appSetting.findUnique({
      where: { key: CONTINUATION_KEY },
      select: { value: true },
    });
    const continuationValue =
      continuationSetting?.value && typeof continuationSetting.value === "object"
        ? (continuationSetting.value as Record<string, unknown>)
        : null;
    const continuationRequests = Array.isArray(continuationValue?.requests)
      ? continuationValue.requests
      : [];
    const filteredContinuationRequests = continuationRequests.filter((request) => {
      if (!request || typeof request !== "object") return false;
      const row = request as Record<string, unknown>;
      return row.jobId !== jobId && row.continuationJobId !== jobId;
    });

    await db.$transaction(async (tx) => {
      for (const stockTx of stockTxs) {
        await tx.propertyStock.update({
          where: { id: stockTx.propertyStockId },
          data: {
            onHand: {
              increment: Number((-stockTx.quantity).toFixed(2)),
            },
          },
        });
      }

      await tx.stockTx.deleteMany({ where: { submission: { jobId } } });
      await tx.submissionMedia.deleteMany({ where: { submission: { jobId } } });
      await tx.formSubmission.deleteMany({ where: { jobId } });
      await tx.timeLog.deleteMany({ where: { jobId } });
      await tx.jobAssignment.deleteMany({ where: { jobId } });
      await tx.qAReview.deleteMany({ where: { jobId } });
      await tx.issueTicket.deleteMany({ where: { jobId } });
      await tx.report.deleteMany({ where: { jobId } });
      await tx.cleanerPayAdjustment.deleteMany({ where: { jobId } });
      await tx.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId } } });
      await tx.laundryTask.deleteMany({ where: { jobId } });
      await tx.notification.deleteMany({ where: { jobId } });

      await tx.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.UNASSIGNED,
          actualHours: null,
          reminder24hSent: false,
          reminder2hSent: false,
        },
      });

      await tx.appSetting.upsert({
        where: { key: CONTINUATION_KEY },
        create: {
          key: CONTINUATION_KEY,
          value: { requests: filteredContinuationRequests } as any,
        },
        update: {
          value: { requests: filteredContinuationRequests } as any,
        },
      });
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId,
        action: "RESET_JOB",
        entity: "Job",
        entityId: jobId,
        after: {
          status: JobStatus.UNASSIGNED,
          clearedAssignments: true,
          clearedSubmissions: true,
          restoredInventoryTransactions: stockTxs.length,
        } as any,
      },
    });

    return NextResponse.json({
      ok: true,
      restoredInventoryTransactions: stockTxs.length,
      clearedContinuationRequests: continuationRequests.length - filteredContinuationRequests.length,
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
