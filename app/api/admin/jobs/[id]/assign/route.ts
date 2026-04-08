import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assignJobSchema } from "@/lib/validations/job";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import {
  Role,
  NotificationChannel,
  NotificationStatus,
  JobAssignmentResponseStatus,
  JobStatus,
} from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { resolveNotificationRuleRecipients } from "@/lib/phase4/notification-rules";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { resolveAppUrl } from "@/lib/app-url";
import { getJobReference } from "@/lib/jobs/job-number";
import {
  derivePreStartJobStatus,
  formatAssignmentResponseLabel,
} from "@/lib/jobs/assignment-workflow";
import { attachPendingAdminTasksToJob } from "@/lib/job-tasks/service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { userIds, primaryUserId } = assignJobSchema.parse(await req.json());
    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        propertyId: true,
        jobNumber: true,
        status: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        internalNotes: true,
        property: { select: { name: true, suburb: true } },
        assignments: {
          select: {
            id: true,
            userId: true,
            removedAt: true,
            responseStatus: true,
          },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const activeAssignments = job.assignments.filter((assignment) => !assignment.removedAt);
    const previousAssignedIds = activeAssignments.map((assignment) => assignment.userId);
    const existingAssignmentsByUserId = new Map(
      job.assignments.map((assignment) => [assignment.userId, assignment])
    );
    const cleaners = await db.user.findMany({
      where: { id: { in: userIds }, role: Role.CLEANER, isActive: true },
      select: { id: true, name: true, email: true, phone: true },
    });
    const cleanerIds = new Set(cleaners.map((u) => u.id));
    const invalidIds = userIds.filter((id) => !cleanerIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Only active CLEANER users can be assigned. Invalid IDs: ${invalidIds.join(", ")}` },
        { status: 400 }
      );
    }
    if (primaryUserId && !cleanerIds.has(primaryUserId)) {
      return NextResponse.json({ error: "Primary cleaner must be in assignment list." }, { status: 400 });
    }
    const settings = await getAppSettings();
    const assignmentChangedAt = new Date();
    let nextStatus: JobStatus = job.status;

    await db.$transaction(async (tx) => {
      await tx.jobAssignment.updateMany({
        where:
          userIds.length === 0
            ? { jobId: params.id, removedAt: null }
            : { jobId: params.id, removedAt: null, userId: { notIn: userIds } },
        data: {
          removedAt: assignmentChangedAt,
          isPrimary: false,
        },
      });

      for (const userId of userIds) {
        const configuredRate = settings.cleanerJobHourlyRates?.[userId]?.[job.jobType] ?? null;
        const existing = existingAssignmentsByUserId.get(userId);
        const isReoffered = !existing || Boolean(existing.removedAt);
        await tx.jobAssignment.upsert({
          where: { jobId_userId: { jobId: params.id, userId } },
          create: {
            jobId: params.id,
            userId,
            isPrimary: userId === (primaryUserId ?? userIds[0]),
            payRate: configuredRate,
            offeredAt: assignmentChangedAt,
            responseStatus: JobAssignmentResponseStatus.PENDING,
            assignedById: session.user.id,
          },
          update: {
            isPrimary: userId === (primaryUserId ?? userIds[0]),
            payRate: configuredRate,
            removedAt: null,
            ...(isReoffered
              ? {
                  offeredAt: assignmentChangedAt,
                  responseStatus: JobAssignmentResponseStatus.PENDING,
                  respondedAt: null,
                  responseNote: null,
                  assignedById: session.user.id,
                  transferredFromUserId: null,
                }
              : {}),
          },
        });
      }

      const currentAssignments = await tx.jobAssignment.findMany({
        where: { jobId: params.id, removedAt: null },
        select: { removedAt: true, responseStatus: true },
      });
      nextStatus = derivePreStartJobStatus(job.status, currentAssignments);

      if (nextStatus !== job.status) {
        await tx.job.update({
          where: { id: params.id },
          data: { status: nextStatus },
        });
      }
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: "ASSIGN_JOB",
        entity: "Job",
        entityId: params.id,
        after: { userIds, primaryUserId } as any,
      },
    });

    const currentAssignedIds = new Set(userIds);
    const removedIds = previousAssignedIds.filter((id) => !currentAssignedIds.has(id));
    const targetUsers = new Map(cleaners.map((cleaner) => [cleaner.id, cleaner]));
    if (removedIds.length > 0) {
      const removedUsers = await db.user.findMany({
        where: { id: { in: removedIds }, role: Role.CLEANER },
        select: { id: true, name: true, email: true, phone: true },
      });
      for (const user of removedUsers) {
        targetUsers.set(user.id, user);
      }
    }

    const jobLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
    const jobReference = getJobReference(job);
    const when = `${job.scheduledDate.toISOString().slice(0, 10)}${job.startTime ? ` ${job.startTime}` : ""}${job.dueTime ? ` - ${job.dueTime}` : ""}`;
    const timingHighlights = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes));
    const timingText = timingHighlights.length > 0 ? timingHighlights.join(" | ") : "Standard schedule";
    const timingSentence = timingHighlights.length > 0 ? ` Timing: ${timingText}.` : "";
    const companyName = settings.companyName || "sNeek Property Services";

    for (const [userId, user] of Array.from(targetUsers.entries())) {
      const stillAssigned = currentAssignedIds.has(userId);
      const previousAssignment = existingAssignmentsByUserId.get(userId);
      const isNewOffer = stillAssigned && (!previousAssignment || Boolean(previousAssignment.removedAt));
      const responseStatus =
        stillAssigned && isNewOffer
          ? JobAssignmentResponseStatus.PENDING
          : previousAssignment?.responseStatus ?? null;
      const responseLabel = formatAssignmentResponseLabel(responseStatus);
      const subject = stillAssigned
        ? isNewOffer
          ? `${companyName}: New job offer (${jobReference})`
          : `${companyName}: Job assignment updated (${jobReference})`
        : `${companyName}: Job removed from your schedule (${jobReference})`;
      const jobUrl = resolveAppUrl(`/cleaner/jobs/${job.id}`, req);
      const notificationTemplate = renderNotificationTemplate(
        settings,
        stillAssigned ? "jobAssigned" : "jobRemoved",
          {
            jobNumber: jobReference,
            jobType: job.jobType.replace(/_/g, " "),
            propertyName: jobLabel,
            when,
            timingFlags: stillAssigned ? `${timingText} | ${responseLabel}` : timingText,
          }
      );

      await db.notification.create({
        data: {
          userId,
          jobId: job.id,
          channel: NotificationChannel.PUSH,
          subject: notificationTemplate.webSubject || subject,
          body: notificationTemplate.webBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      if (user.email) {
        const emailTemplate = renderEmailTemplate(
          {
            companyName,
            logoUrl: settings.logoUrl,
            emailTemplates: settings.emailTemplates,
          },
          stillAssigned ? "jobAssigned" : "jobRemoved",
          {
            userName: user.name ?? user.email,
            jobType: job.jobType.replace(/_/g, " "),
            propertyName: jobLabel,
            jobNumber: jobReference,
            when,
            jobUrl,
            timingFlags: stillAssigned ? `${timingText} | ${responseLabel}` : timingText,
          }
        );
        const emailResult = await sendEmailDetailed({
          to: user.email,
          subject: emailTemplate.subject,
          html: emailTemplate.html,
        });

        await db.notification.create({
          data: {
            userId,
            jobId: job.id,
            channel: NotificationChannel.EMAIL,
            subject,
            body: `Assignment email sent to ${user.email}`,
            status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: emailResult.ok ? new Date() : undefined,
            errorMsg: emailResult.ok ? undefined : emailResult.error,
          },
        });
      }

      if (user.phone) {
        const smsResult = await sendSmsDetailed(user.phone, notificationTemplate.smsBody);

        if (smsResult.status === "sent" || smsResult.status === "failed") {
          await db.notification.create({
            data: {
              userId,
              jobId: job.id,
              channel: NotificationChannel.SMS,
              subject,
              body: `Assignment SMS sent to ${user.phone}`,
              status: smsResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
              sentAt: smsResult.ok ? new Date() : undefined,
              errorMsg: smsResult.ok ? undefined : smsResult.error ?? "SMS provider failed.",
            },
          });
        }
      }
    }

    const ruleResolution = await resolveNotificationRuleRecipients({
      event: "JOB_ASSIGNED",
      payload: {
        jobId: job.id,
        status: nextStatus,
        jobType: job.jobType,
      },
    });
    if (ruleResolution.recipients.length > 0) {
      const idsAlreadyNotified = new Set(Array.from(targetUsers.keys()));
      await db.notification.createMany({
        data: ruleResolution.recipients
          .filter((recipient) => !idsAlreadyNotified.has(recipient.userId))
          .map((recipient) => ({
            userId: recipient.userId,
            jobId: job.id,
            channel: NotificationChannel.PUSH,
            subject: `${companyName}: Rule alert`,
            body: renderNotificationTemplate(settings, "jobAssigned", {
              jobNumber: jobReference,
              jobType: job.jobType.replace(/_/g, " "),
              propertyName: jobLabel,
              when,
              timingFlags: timingText,
            }).webBody,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
      });
    }

    // Attach any pending admin tasks queued for this property
    await attachPendingAdminTasksToJob({ jobId: job.id, propertyId: job.propertyId });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
