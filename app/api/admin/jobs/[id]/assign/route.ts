import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assignJobSchema } from "@/lib/validations/job";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { Role, JobStatus, NotificationChannel, NotificationStatus } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveNotificationRuleRecipients } from "@/lib/phase4/notification-rules";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { resolveAppUrl } from "@/lib/app-url";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { userIds, primaryUserId, confirmCompletedReset } = assignJobSchema.parse(await req.json());
    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        internalNotes: true,
        property: { select: { name: true, suburb: true } },
        assignments: { select: { userId: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const previousAssignedIds = job.assignments.map((assignment) => assignment.userId);
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
    if (
      userIds.length === 0 &&
      (job.status === JobStatus.COMPLETED || job.status === JobStatus.INVOICED) &&
      !confirmCompletedReset
    ) {
      return NextResponse.json(
        { error: "CONFIRM_COMPLETED_RESET_REQUIRED", message: "Confirm moving a completed job back to unassigned." },
        { status: 409 }
      );
    }

    const settings = await getAppSettings();

    // Remove assignments not in new list
    await db.jobAssignment.deleteMany({
      where: userIds.length === 0 ? { jobId: params.id } : { jobId: params.id, userId: { notIn: userIds } },
    });

    // Upsert new assignments
    for (const userId of userIds) {
      const configuredRate = settings.cleanerJobHourlyRates?.[userId]?.[job.jobType] ?? null;
      await db.jobAssignment.upsert({
        where: { jobId_userId: { jobId: params.id, userId } },
        create: {
          jobId: params.id,
          userId,
          isPrimary: userId === (primaryUserId ?? userIds[0]),
          payRate: configuredRate,
        },
        update: {
          isPrimary: userId === (primaryUserId ?? userIds[0]),
          payRate: configuredRate,
          removedAt: null,
        },
      });
    }

    // Advance job status to ASSIGNED
    await db.job.update({
      where: { id: params.id },
      data: { status: userIds.length > 0 ? JobStatus.ASSIGNED : JobStatus.UNASSIGNED },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: "ASSIGN_JOB",
        entity: "Job",
        entityId: params.id,
        after: { userIds, primaryUserId, confirmCompletedReset: !!confirmCompletedReset } as any,
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
    const when = `${job.scheduledDate.toISOString().slice(0, 10)}${job.startTime ? ` ${job.startTime}` : ""}${job.dueTime ? ` - ${job.dueTime}` : ""}`;
    const timingHighlights = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes));
    const timingText = timingHighlights.length > 0 ? timingHighlights.join(" | ") : "Standard schedule";
    const timingSentence = timingHighlights.length > 0 ? ` Timing: ${timingText}.` : "";
    const companyName = settings.companyName || "sNeek Property Services";

    for (const [userId, user] of Array.from(targetUsers.entries())) {
      const stillAssigned = currentAssignedIds.has(userId);
      const subject = stillAssigned
        ? `${companyName}: Job assignment updated`
        : `${companyName}: Job removed from your schedule`;
      const bodyText = stillAssigned
        ? `You have been assigned to ${job.jobType.replace(/_/g, " ")} at ${jobLabel} on ${when}.${timingSentence}`
        : `You have been removed from ${job.jobType.replace(/_/g, " ")} at ${jobLabel} on ${when}.${timingSentence}`;
      const jobUrl = resolveAppUrl(`/cleaner/jobs/${job.id}`, req);

      await db.notification.create({
        data: {
          userId,
          jobId: job.id,
          channel: NotificationChannel.PUSH,
          subject,
          body: bodyText,
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
            when,
            jobUrl,
            timingFlags: timingText,
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

      if (user.phone && /^\+\d{8,15}$/.test(user.phone)) {
        const smsOk = await sendSms(
          user.phone,
          `${companyName}: ${stillAssigned ? "Assigned" : "Removed"} ${job.jobType.replace(/_/g, " ")} at ${jobLabel} on ${when}.${timingSentence}`
        );

        await db.notification.create({
          data: {
            userId,
            jobId: job.id,
            channel: NotificationChannel.SMS,
            subject,
            body: `Assignment SMS sent to ${user.phone}`,
            status: smsOk ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: smsOk ? new Date() : undefined,
            errorMsg: smsOk ? undefined : "SMS provider failed or is not configured.",
          },
        });
      }
    }

    const ruleResolution = await resolveNotificationRuleRecipients({
      event: "JOB_ASSIGNED",
      payload: {
        jobId: job.id,
        status: userIds.length > 0 ? "ASSIGNED" : "UNASSIGNED",
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
            body: `${job.jobType.replace(/_/g, " ")} at ${jobLabel} on ${when}.${timingSentence}`,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
