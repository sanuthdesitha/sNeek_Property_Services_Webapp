import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { applyAutoAssignment } from "@/lib/ops/dispatch";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { renderEmailTemplate } from "@/lib/email-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { resolveAppUrl } from "@/lib/app-url";
import { getJobReference } from "@/lib/jobs/job-number";
import { NotificationChannel, NotificationStatus } from "@prisma/client";

const schema = z.object({
  cleanerIds: z.array(z.string().trim().min(1)).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    await applyAutoAssignment(params.jobId, body.cleanerIds, session.user.id);
    const [settings, job, cleaners] = await Promise.all([
      getAppSettings(),
      db.job.findUnique({
        where: { id: params.jobId },
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          property: { select: { name: true, suburb: true } },
        },
      }),
      db.user.findMany({
        where: { id: { in: body.cleanerIds }, role: Role.CLEANER, isActive: true },
        select: { id: true, name: true, email: true, phone: true },
      }),
    ]);

    if (job) {
      const companyName = settings.companyName || "sNeek Property Services";
      const jobReference = getJobReference(job as any);
      const propertyLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
      const when = `${job.scheduledDate.toISOString().slice(0, 10)}${job.startTime ? ` ${job.startTime}` : ""}${job.dueTime ? ` - ${job.dueTime}` : ""}`;
      const jobUrl = resolveAppUrl(`/cleaner/jobs/${job.id}`, req);
      for (const cleaner of cleaners) {
        const notificationTemplate = renderNotificationTemplate(settings, "jobAssigned", {
          jobNumber: jobReference,
          jobType: job.jobType.replace(/_/g, " "),
          propertyName: propertyLabel,
          when,
          timingFlags: "Awaiting confirmation",
        });
        await db.notification.create({
          data: {
            userId: cleaner.id,
            jobId: job.id,
            channel: NotificationChannel.PUSH,
            subject: `${companyName}: New job offer (${jobReference})`,
            body: notificationTemplate.webBody,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });

        if (cleaner.email) {
          const emailTemplate = renderEmailTemplate(
            {
              companyName,
              logoUrl: settings.logoUrl,
              emailTemplates: settings.emailTemplates,
            },
            "jobAssigned",
            {
              userName: cleaner.name ?? cleaner.email,
              jobType: job.jobType.replace(/_/g, " "),
              propertyName: propertyLabel,
              jobNumber: jobReference,
              when,
              jobUrl,
              timingFlags: "Awaiting confirmation",
            }
          );
          const emailResult = await sendEmailDetailed({
            to: cleaner.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
          });
          await db.notification.create({
            data: {
              userId: cleaner.id,
              jobId: job.id,
              channel: NotificationChannel.EMAIL,
              subject: emailTemplate.subject,
              body: `Assignment email sent to ${cleaner.email}`,
              status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
              sentAt: emailResult.ok ? new Date() : undefined,
              errorMsg: emailResult.ok ? undefined : emailResult.error,
            },
          });
        }

        if (cleaner.phone) {
          const smsResult = await sendSmsDetailed(cleaner.phone, notificationTemplate.smsBody);
          if (smsResult.status === "sent" || smsResult.status === "failed") {
            await db.notification.create({
              data: {
                userId: cleaner.id,
                jobId: job.id,
                channel: NotificationChannel.SMS,
                subject: `${companyName}: New job offer (${jobReference})`,
                body: notificationTemplate.smsBody,
                status: smsResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
                sentAt: smsResult.ok ? new Date() : undefined,
                errorMsg: smsResult.ok ? undefined : smsResult.error ?? "SMS provider failed.",
              },
            });
          }
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not apply auto assignment." }, { status });
  }
}
