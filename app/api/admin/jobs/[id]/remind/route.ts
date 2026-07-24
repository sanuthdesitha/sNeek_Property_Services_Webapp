import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { JobStatus, NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

/**
 * Manual "Send reminder" for an unfinished job — pushes or emails every
 * non-removed assigned cleaner. Only PAUSED / IN_PROGRESS / SUBMITTED jobs are
 * remindable; anything else is rejected so the bulk action can report clean
 * skips. Every send is audited (JOB_REMINDER_SENT).
 */
const REMINDABLE_STATUSES: JobStatus[] = [
  JobStatus.PAUSED,
  JobStatus.IN_PROGRESS,
  JobStatus.SUBMITTED,
];

const bodySchema = z.object({
  method: z.enum(["PUSH", "EMAIL"]),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        property: { select: { name: true, address: true } },
        assignments: {
          where: { removedAt: null, user: { isActive: true } },
          select: { userId: true, user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (!REMINDABLE_STATUSES.includes(job.status)) {
      return NextResponse.json(
        { error: `Job is ${job.status.replace(/_/g, " ").toLowerCase()} — not in a remindable state.`, notRemindable: true },
        { status: 409 }
      );
    }
    if (job.assignments.length === 0) {
      return NextResponse.json({ error: "No assigned cleaners to remind." }, { status: 400 });
    }

    const propertyName = job.property?.name ?? "the property";
    const whenLabel = `${format(new Date(job.scheduledDate), "EEE d MMM yyyy")}${job.startTime ? ` ${job.startTime}` : ""}`;
    const message = `You have an unfinished job at ${propertyName} scheduled ${whenLabel} — please open it and submit your checklist.${
      body.note ? ` Note from admin: ${body.note}` : ""
    }`;

    const sent: string[] = [];
    const failed: string[] = [];

    for (const assignment of job.assignments) {
      const displayName = assignment.user.name ?? assignment.user.email ?? "Cleaner";
      try {
        if (body.method === "PUSH") {
          await db.notification.create({
            data: {
              userId: assignment.userId,
              jobId: job.id,
              channel: NotificationChannel.PUSH,
              subject: "Unfinished job reminder",
              body: message,
              status: NotificationStatus.SENT,
              sentAt: new Date(),
            },
          });
          await sendWebPushToUser(assignment.userId, {
            title: "Unfinished job reminder",
            body: message,
            url: "/cleaner/jobs",
            tag: `job-reminder-${job.id}`,
          });
          sent.push(displayName);
        } else {
          if (!assignment.user.email) {
            failed.push(displayName);
            continue;
          }
          const res = await sendEmailDetailed({
            kind: "job_reminder",
            to: assignment.user.email,
            subject: `Reminder: unfinished job at ${propertyName} (${job.jobNumber || job.id})`,
            html: `
              <p>Hi ${displayName},</p>
              <p>You have an unfinished job at <strong>${propertyName}</strong> scheduled <strong>${whenLabel}</strong> — please open it and submit your checklist.</p>
              ${body.note ? `<p><em>Note from admin:</em> ${body.note}</p>` : ""}
              <p><a href="${resolveAppUrl("/cleaner/jobs", req)}">Open your jobs</a></p>
              <p>— sNeek Ops</p>
            `,
          });
          if (res.ok) sent.push(displayName);
          else failed.push(displayName);
        }
      } catch {
        failed.push(displayName);
      }
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: job.id,
        action: "JOB_REMINDER_SENT",
        entity: "Job",
        entityId: job.id,
        after: {
          method: body.method,
          cleanerIds: job.assignments.map((a) => a.userId),
          sent,
          failed,
          note: body.note ?? null,
        } as any,
      },
    });

    return NextResponse.json({ sent, failed });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
