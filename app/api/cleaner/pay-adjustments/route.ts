import { NextRequest, NextResponse } from "next/server";
import { JobStatus, NotificationChannel, NotificationStatus, PayAdjustmentStatus, PayAdjustmentType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { resolveAppUrl } from "@/lib/app-url";
import { getJobReference } from "@/lib/jobs/job-number";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

const createSchema = z.object({
  jobId: z.string().trim().min(1),
  type: z.nativeEnum(PayAdjustmentType),
  requestedHours: z.number().positive().optional(),
  requestedRate: z.number().positive().optional(),
  requestedAmount: z.number().positive().optional(),
  cleanerNote: z.string().trim().max(4000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "payRequests")) {
      return NextResponse.json({ error: "Pay requests are disabled for cleaners." }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId") ?? undefined;
    const statusRaw = searchParams.get("status");
    const status = statusRaw && Object.values(PayAdjustmentStatus).includes(statusRaw as PayAdjustmentStatus)
      ? (statusRaw as PayAdjustmentStatus)
      : undefined;

    const rows = await db.cleanerPayAdjustment.findMany({
      where: {
        cleanerId: session.user.id,
        ...(jobId ? { jobId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        job: {
          select: {
            id: true,
            jobNumber: true,
            jobType: true,
            scheduledDate: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
      orderBy: { requestedAt: "desc" },
    });

    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "payRequests")) {
      return NextResponse.json({ error: "Pay requests are disabled for cleaners." }, { status: 403 });
    }
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const job = await db.job.findUnique({
      where: { id: body.jobId },
      include: {
        property: { select: { name: true } },
        assignments: {
          select: { userId: true, payRate: true, removedAt: true },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (job.status === JobStatus.UNASSIGNED) {
      return NextResponse.json(
        { error: "Extra payment requests are available only after the job is assigned." },
        { status: 400 }
      );
    }

    const activeAssignment = job.assignments.find((a) => a.userId === session.user.id && !a.removedAt);
    if (!activeAssignment) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    let requestedHours: number | undefined;
    let requestedRate: number | undefined;
    let requestedAmount: number;

    if (body.type === PayAdjustmentType.HOURLY) {
      requestedHours = Number(body.requestedHours ?? 0);
      if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
        return NextResponse.json({ error: "Requested hours must be greater than 0 for hourly requests." }, { status: 400 });
      }
      requestedRate =
        body.requestedRate ??
        activeAssignment.payRate ??
        settings.cleanerJobHourlyRates?.[session.user.id]?.[job.jobType] ??
        undefined;
      if (!requestedRate || !Number.isFinite(requestedRate) || requestedRate <= 0) {
        return NextResponse.json({ error: "Requested rate is required for hourly requests." }, { status: 400 });
      }
      requestedAmount = requestedHours * requestedRate;
    } else {
      requestedAmount = Number(body.requestedAmount ?? 0);
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return NextResponse.json({ error: "Requested amount must be greater than 0 for fixed requests." }, { status: 400 });
      }
    }

    const created = await db.cleanerPayAdjustment.create({
      data: {
        jobId: body.jobId,
        cleanerId: session.user.id,
        type: body.type,
        requestedHours,
        requestedRate,
        requestedAmount,
        cleanerNote: body.cleanerNote?.trim() || undefined,
      },
      include: {
        job: {
          select: {
            id: true,
            jobNumber: true,
            jobType: true,
            scheduledDate: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
    });

    const emailTemplate = renderEmailTemplate(settings, "extraPayRequest", {
      cleanerName: session.user.name ?? session.user.email,
      propertyName: created.job.property.name,
      jobType: created.job.jobType.replace(/_/g, " "),
      jobNumber: getJobReference(created.job),
      requestType: created.type,
      requestedAmount: `$${created.requestedAmount.toFixed(2)}`,
      cleanerNote: created.cleanerNote ?? "-",
      actionUrl: resolveAppUrl("/admin/pay-adjustments", req),
      actionLabel: "Review pay request",
    });

    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true, email: true, phone: true, role: true, name: true },
      take: 50,
    });
    const alertSubject = `Cleaner extra pay request (${getJobReference(created.job)})`;
    const notificationTemplate = renderNotificationTemplate(settings, "extraPayRequest", {
      cleanerName: session.user.name ?? session.user.email,
      propertyName: created.job.property.name,
      jobNumber: getJobReference(created.job),
      requestType: created.type,
      requestedAmount: `$${created.requestedAmount.toFixed(2)}`,
    });
    const alertBody = notificationTemplate.webBody;
    if (admins.length > 0) {
      await deliverNotificationToRecipients({
        recipients: admins,
        category: "approvals",
        jobId: created.job.id,
        web: {
          subject: notificationTemplate.webSubject || alertSubject,
          body: alertBody,
        },
        email: {
          subject: emailTemplate.subject,
          html: emailTemplate.html,
          logBody: alertBody,
        },
        sms: notificationTemplate.smsBody,
      });
    }

    const emailResult = settings.accountsEmail
      ? await sendEmailDetailed({
          to: settings.accountsEmail,
          subject: emailTemplate.subject,
          html: emailTemplate.html,
        })
      : { ok: false, error: "Accounts email is not configured." };

    await db.notification.create({
      data: {
        userId: session.user.id,
        jobId: created.job.id,
        channel: NotificationChannel.EMAIL,
        subject: "Extra payment request sent to admin",
        body: `Request ${created.id} submitted for admin review.`,
        status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: emailResult.ok ? new Date() : undefined,
        errorMsg: emailResult.ok ? undefined : emailResult.error ?? "Email provider failure.",
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
