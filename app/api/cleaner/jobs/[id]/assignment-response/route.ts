import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  JobAssignmentResponseStatus,
  JobStatus,
  Role,
} from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { resolveAppUrl } from "@/lib/app-url";
import { getJobReference } from "@/lib/jobs/job-number";
import {
  derivePreStartJobStatus,
  formatAssignmentResponseLabel,
  formatJobStatusLabel,
  PRE_START_JOB_STATUSES,
} from "@/lib/jobs/assignment-workflow";

const schema = z.object({
  action: z.enum(["ACCEPT", "DECLINE", "TRANSFER"]),
  note: z.string().trim().max(2000).optional(),
  targetCleanerId: z.string().trim().min(1).optional(),
});

const FINISHED_STATUSES = new Set<JobStatus>([
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
]);

type TransferRecipient = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const settings = await getAppSettings();

    const [job, assignment, adminRecipients] = await Promise.all([
      db.job.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          property: {
            select: {
              name: true,
              suburb: true,
            },
          },
          assignments: {
            where: { removedAt: null },
            select: {
              id: true,
              userId: true,
              isPrimary: true,
              responseStatus: true,
              removedAt: true,
            },
          },
        },
      }),
      db.jobAssignment.findFirst({
        where: {
          jobId: params.id,
          userId: session.user.id,
          removedAt: null,
        },
        select: {
          id: true,
          jobId: true,
          userId: true,
          isPrimary: true,
          responseStatus: true,
        },
      }),
      db.user.findMany({
        where: {
          role: { in: [Role.ADMIN, Role.OPS_MANAGER] },
          isActive: true,
        },
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          phone: true,
        },
      }),
    ]);

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (!assignment) {
      return NextResponse.json({ error: "You are not actively assigned to this job." }, { status: 403 });
    }
    if (FINISHED_STATUSES.has(job.status)) {
      return NextResponse.json({ error: "This job is already finished." }, { status: 400 });
    }
    if ((body.action === "DECLINE" || body.action === "TRANSFER") && !PRE_START_JOB_STATUSES.has(job.status)) {
      return NextResponse.json(
        { error: "This job has already progressed. Use admin review for reassignment changes." },
        { status: 409 }
      );
    }

    const actorName = session.user.name?.trim() || session.user.email || "Cleaner";
    const propertyLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
    const jobReference = getJobReference(job);
    const when = `${job.scheduledDate.toISOString().slice(0, 10)}${job.startTime ? ` ${job.startTime}` : ""}${job.dueTime ? ` - ${job.dueTime}` : ""}`;
    const companyName = settings.companyName || "sNeek Property Services";
    const note = body.note?.trim() || null;
    const changedAt = new Date();
    let nextStatus = job.status;
    let transferredCleanerLabel = "another cleaner";
    let transferredCleaner: TransferRecipient | null = null;

    await db.$transaction(async (tx) => {
      if (body.action === "ACCEPT") {
        await tx.jobAssignment.update({
          where: { id: assignment.id },
          data: {
            responseStatus: JobAssignmentResponseStatus.ACCEPTED,
            respondedAt: changedAt,
            responseNote: note,
          },
        });
      } else if (body.action === "DECLINE") {
        await tx.jobAssignment.update({
          where: { id: assignment.id },
          data: {
            responseStatus: JobAssignmentResponseStatus.DECLINED,
            respondedAt: changedAt,
            responseNote: note,
            removedAt: changedAt,
            isPrimary: false,
          },
        });
      } else {
        const targetCleanerId = body.targetCleanerId?.trim();
        if (!targetCleanerId) {
          throw new Error("Choose the cleaner you want to transfer this job to.");
        }
        if (targetCleanerId === session.user.id) {
          throw new Error("Choose a different cleaner for the transfer.");
        }

        transferredCleaner = await tx.user.findFirst({
          where: {
            id: targetCleanerId,
            role: Role.CLEANER,
            isActive: true,
          },
          select: {
            id: true,
            role: true,
            name: true,
            email: true,
            phone: true,
          },
        });
        if (!transferredCleaner) {
          throw new Error("The selected cleaner is not available.");
        }
        transferredCleanerLabel = transferredCleaner.name ?? transferredCleaner.email ?? "another cleaner";

        const existingTarget = await tx.jobAssignment.findFirst({
          where: {
            jobId: params.id,
            userId: targetCleanerId,
            removedAt: null,
          },
          select: { id: true },
        });
        if (existingTarget) {
          throw new Error("That cleaner already has an active assignment for this job.");
        }

        await tx.jobAssignment.update({
          where: { id: assignment.id },
          data: {
            responseStatus: JobAssignmentResponseStatus.TRANSFERRED,
            respondedAt: changedAt,
            responseNote: note,
            removedAt: changedAt,
            isPrimary: false,
          },
        });

        await tx.jobAssignment.upsert({
          where: {
            jobId_userId: {
              jobId: params.id,
              userId: targetCleanerId,
            },
          },
          create: {
            jobId: params.id,
            userId: targetCleanerId,
            isPrimary: assignment.isPrimary,
            offeredAt: changedAt,
            responseStatus: JobAssignmentResponseStatus.PENDING,
            assignedById: session.user.id,
            transferredFromUserId: session.user.id,
          },
          update: {
            removedAt: null,
            isPrimary: assignment.isPrimary,
            offeredAt: changedAt,
            responseStatus: JobAssignmentResponseStatus.PENDING,
            respondedAt: null,
            responseNote: null,
            assignedById: session.user.id,
            transferredFromUserId: session.user.id,
          },
        });
      }

      const activeAssignments = await tx.jobAssignment.findMany({
        where: { jobId: params.id, removedAt: null },
        select: {
          removedAt: true,
          responseStatus: true,
        },
      });
      nextStatus = derivePreStartJobStatus(job.status, activeAssignments);
      if (nextStatus !== job.status) {
        await tx.job.update({
          where: { id: params.id },
          data: { status: nextStatus },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action:
            body.action === "ACCEPT"
              ? "ACCEPT_JOB_ASSIGNMENT"
              : body.action === "DECLINE"
                ? "DECLINE_JOB_ASSIGNMENT"
                : "TRANSFER_JOB_ASSIGNMENT",
          entity: "JobAssignment",
          entityId: assignment.id,
          after: {
            action: body.action,
            note,
            targetCleanerId: transferredCleaner?.id ?? null,
            nextStatus,
          } as any,
        },
      });
    });

    const adminSubject =
      body.action === "ACCEPT"
        ? `${companyName}: Job accepted (${jobReference})`
        : body.action === "DECLINE"
          ? `${companyName}: Job declined (${jobReference})`
          : `${companyName}: Job transferred (${jobReference})`;
    const adminNoteText = note ? `<p><strong>Cleaner note:</strong> ${note}</p>` : "";
    await deliverNotificationToRecipients({
      recipients: adminRecipients,
      category: "jobs",
      jobId: job.id,
      web: {
        subject: adminSubject,
        body:
          body.action === "ACCEPT"
            ? `${actorName} accepted ${jobReference} for ${propertyLabel}.`
            : body.action === "DECLINE"
              ? `${actorName} declined ${jobReference} for ${propertyLabel}.`
              : `${actorName} transferred ${jobReference} for ${propertyLabel} to ${transferredCleanerLabel}.`,
      },
      email: {
        subject: adminSubject,
        html: `
          <h2 style="margin:0 0 12px;">${adminSubject}</h2>
          <p><strong>${jobReference}</strong> for <strong>${propertyLabel}</strong> (${when}) was updated.</p>
          <p><strong>Cleaner:</strong> ${actorName}</p>
          <p><strong>Outcome:</strong> ${body.action === "ACCEPT" ? "Accepted" : body.action === "DECLINE" ? "Declined" : `Transferred to ${transferredCleanerLabel}`}</p>
          <p><strong>Next job status:</strong> ${formatJobStatusLabel(nextStatus)}</p>
          ${adminNoteText}
        `,
        logBody: adminSubject,
      },
      sms:
        body.action === "ACCEPT"
          ? `${actorName} accepted ${jobReference} at ${propertyLabel}.`
          : body.action === "DECLINE"
            ? `${actorName} declined ${jobReference} at ${propertyLabel}.`
            : `${actorName} transferred ${jobReference} to ${transferredCleanerLabel}.`,
    });

    if (body.action === "TRANSFER" && transferredCleaner) {
      const transferRecipient: TransferRecipient = transferredCleaner;
      const jobUrl = resolveAppUrl(`/cleaner/jobs/${job.id}`, req);
      const cleanerTemplate = renderNotificationTemplate(settings, "jobAssigned", {
        jobNumber: jobReference,
        jobType: job.jobType.replace(/_/g, " "),
        propertyName: propertyLabel,
        when,
        timingFlags: "Awaiting confirmation",
      });
      const emailTemplate = renderEmailTemplate(
        {
          companyName,
          logoUrl: settings.logoUrl,
          emailTemplates: settings.emailTemplates,
        },
        "jobAssigned",
        {
          userName: transferRecipient.name ?? transferRecipient.email,
          jobType: job.jobType.replace(/_/g, " "),
          propertyName: propertyLabel,
          jobNumber: jobReference,
          when,
          jobUrl,
          timingFlags: `Transferred by ${actorName}. Awaiting confirmation.`,
        }
      );
      await deliverNotificationToRecipients({
        recipients: [transferRecipient],
        category: "jobs",
        jobId: job.id,
        web: {
          subject: `${companyName}: New transferred job offer (${jobReference})`,
          body: cleanerTemplate.webBody,
        },
        email: {
          subject: emailTemplate.subject,
          html: emailTemplate.html,
          logBody: emailTemplate.subject,
        },
        sms: cleanerTemplate.smsBody,
      });
    }

    return NextResponse.json({
      ok: true,
      action: body.action,
      jobStatus: nextStatus,
      assignmentStatus:
        body.action === "ACCEPT"
          ? JobAssignmentResponseStatus.ACCEPTED
          : body.action === "DECLINE"
            ? JobAssignmentResponseStatus.DECLINED
            : JobAssignmentResponseStatus.TRANSFERRED,
      assignmentStatusLabel: formatAssignmentResponseLabel(
        body.action === "ACCEPT"
          ? JobAssignmentResponseStatus.ACCEPTED
          : body.action === "DECLINE"
            ? JobAssignmentResponseStatus.DECLINED
            : JobAssignmentResponseStatus.TRANSFERRED
      ),
    });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: error?.message ?? "Could not update the assignment response." },
      { status }
    );
  }
}
