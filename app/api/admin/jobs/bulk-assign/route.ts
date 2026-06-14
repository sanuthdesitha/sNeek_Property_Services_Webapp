import { NextRequest, NextResponse } from "next/server";
import {
  JobAssignmentResponseStatus,
  NotificationChannel,
  NotificationStatus,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { derivePreStartJobStatus } from "@/lib/jobs/assignment-workflow";
import { buildBulkAssignedEmail, type BulkAssignedJobLine } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { resolveAppUrl } from "@/lib/app-url";
import { getJobReference } from "@/lib/jobs/job-number";

const schema = z.object({
  jobIds: z.array(z.string().trim().min(1)).min(1),
  cleanerUserId: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const jobIds = Array.from(new Set(body.jobIds));

    const [settings, cleaner, jobs] = await Promise.all([
      getAppSettings(),
      db.user.findFirst({
        where: { id: body.cleanerUserId, role: Role.CLEANER, isActive: true },
        select: { id: true, name: true, email: true, phone: true },
      }),
      db.job.findMany({
        where: { id: { in: jobIds } },
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          property: { select: { name: true, suburb: true } },
          assignments: {
            where: { removedAt: null },
            select: { userId: true, responseStatus: true },
          },
        },
      }),
    ]);

    if (!cleaner) {
      return NextResponse.json({ error: "Cleaner not found." }, { status: 404 });
    }
    if (jobs.length !== jobIds.length) {
      return NextResponse.json({ error: "One or more jobs were not found." }, { status: 404 });
    }

    const changedAt = new Date();
    await db.$transaction(async (tx) => {
      for (const job of jobs) {
        const existingAssignment = job.assignments.find((assignment) => assignment.userId === cleaner.id) ?? null;
        const alreadyAssigned = Boolean(existingAssignment);
        await tx.jobAssignment.upsert({
          where: { jobId_userId: { jobId: job.id, userId: cleaner.id } },
          create: {
            jobId: job.id,
            userId: cleaner.id,
            isPrimary: job.assignments.length === 0,
            payRate: settings.cleanerJobHourlyRates?.[cleaner.id]?.[job.jobType] ?? undefined,
            offeredAt: changedAt,
            responseStatus: JobAssignmentResponseStatus.PENDING,
            assignedById: session.user.id,
          },
          update: {
            removedAt: null,
            isPrimary: job.assignments.length === 0 || alreadyAssigned,
            payRate: settings.cleanerJobHourlyRates?.[cleaner.id]?.[job.jobType] ?? undefined,
            ...(existingAssignment
              ? {}
              : {
                  offeredAt: changedAt,
                  responseStatus: JobAssignmentResponseStatus.PENDING,
                  respondedAt: null,
                  responseNote: null,
                  assignedById: session.user.id,
                  transferredFromUserId: null,
                }),
          },
        });

        const activeAssignments = await tx.jobAssignment.findMany({
          where: { jobId: job.id, removedAt: null },
          select: { removedAt: true, responseStatus: true },
        });
        const nextStatus = derivePreStartJobStatus(job.status, activeAssignments);

        if (nextStatus !== job.status) {
          await tx.job.update({
            where: { id: job.id },
            data: { status: nextStatus },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: job.id,
            action: "BULK_ASSIGN_JOB",
            entity: "Job",
            entityId: job.id,
            after: { cleanerUserId: cleaner.id } as any,
          },
        });
      }
    });

    const companyName = settings.companyName || "sNeek Property Services";
    const jobUrlBase = resolveAppUrl("/cleaner/jobs", req).replace(/\/cleaner\/jobs$/, "");
    const cleanerJobsUrl = `${jobUrlBase}/cleaner/jobs`;

    // Per-job context, computed once and reused for both the in-app feed rows
    // (which stay one-per-job, like elsewhere) and the combined digest.
    const jobLines = jobs.map((job) => {
      const jobReference = getJobReference(job as any);
      const jobLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
      const when = `${job.scheduledDate.toISOString().slice(0, 10)}${job.startTime ? ` ${job.startTime}` : ""}${job.dueTime ? ` - ${job.dueTime}` : ""}`;
      const jobType = job.jobType.replace(/_/g, " ");
      return { job, jobReference, jobLabel, when, jobType };
    });

    // 1) In-app feed: one PUSH notification per job (unchanged behaviour — these
    //    are individual feed items the cleaner taps through to each job).
    for (const line of jobLines) {
      const notificationTemplate = renderNotificationTemplate(settings, "jobAssigned", {
        jobNumber: line.jobReference,
        jobType: line.jobType,
        propertyName: line.jobLabel,
        when: line.when,
        timingFlags: "Awaiting confirmation",
      });
      await db.notification.create({
        data: {
          userId: cleaner.id,
          jobId: line.job.id,
          channel: NotificationChannel.PUSH,
          subject: `${companyName}: New job offer (${line.jobReference})`,
          body: notificationTemplate.webBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    // 2) Email + SMS: ONE combined digest per recipient for the whole bulk
    //    action, instead of N separate messages. Every job is still listed.
    const digestJobLines: BulkAssignedJobLine[] = jobLines.map((line) => ({
      jobReference: line.jobReference,
      jobType: line.jobType,
      propertyName: line.jobLabel,
      when: line.when,
    }));
    const jobCount = digestJobLines.length;
    const jobWord = jobCount === 1 ? "job" : "jobs";
    const digestJobId = jobCount === 1 ? jobLines[0].job.id : null;

    if (cleaner.email) {
      const digest = buildBulkAssignedEmail(
        { companyName, logoUrl: settings.logoUrl },
        {
          userName: cleaner.name ?? cleaner.email,
          jobs: digestJobLines,
          actionUrl: jobCount === 1 ? `${jobUrlBase}/cleaner/jobs/${jobLines[0].job.id}` : cleanerJobsUrl,
        }
      );
      const emailResult = await sendEmailDetailed({
        to: cleaner.email,
        subject: digest.subject,
        html: digest.html,
      });
      await db.notification.create({
        data: {
          userId: cleaner.id,
          jobId: digestJobId,
          channel: NotificationChannel.EMAIL,
          subject: digest.subject,
          body: `Combined assignment email (${jobCount} ${jobWord}) sent to ${cleaner.email}`,
          status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
          sentAt: emailResult.ok ? new Date() : undefined,
          errorMsg: emailResult.ok ? undefined : emailResult.error,
        },
      });
    }

    if (cleaner.phone) {
      const refs = digestJobLines.map((line) => line.jobReference).join(", ");
      const smsBody =
        jobCount === 1
          ? `${companyName}: New job offer ${digestJobLines[0].jobReference} — ${digestJobLines[0].propertyName} on ${digestJobLines[0].when}. Open the app to confirm.`
          : `${companyName}: ${jobCount} new jobs assigned (${refs}). Open the app to review and confirm.`;
      const smsResult = await sendSmsDetailed(cleaner.phone, smsBody);
      if (smsResult.status === "sent" || smsResult.status === "failed") {
        await db.notification.create({
          data: {
            userId: cleaner.id,
            jobId: digestJobId,
            channel: NotificationChannel.SMS,
            subject: `${companyName}: ${jobCount} new ${jobWord} assigned`,
            body: smsBody,
            status: smsResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: smsResult.ok ? new Date() : undefined,
            errorMsg: smsResult.ok ? undefined : smsResult.error ?? "SMS provider failed.",
          },
        });
      }
    }

    return NextResponse.json({ ok: true, updated: jobIds.length, cleaner });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not bulk assign jobs." }, { status });
  }
}
