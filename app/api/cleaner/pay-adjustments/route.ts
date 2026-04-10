import { NextRequest, NextResponse } from "next/server";
import {
  JobType,
  JobStatus,
  NotificationChannel,
  NotificationStatus,
  PayAdjustmentScope,
  PayAdjustmentStatus,
  PayAdjustmentType,
  Role,
} from "@prisma/client";
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
import { publicUrl } from "@/lib/s3";

const createSchema = z
  .object({
    scope: z.nativeEnum(PayAdjustmentScope).default(PayAdjustmentScope.JOB),
    jobId: z.string().trim().min(1).optional(),
    propertyId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    type: z.nativeEnum(PayAdjustmentType),
    requestedHours: z.number().positive().optional(),
    requestedRate: z.number().positive().optional(),
    requestedAmount: z.number().positive().optional(),
    cleanerNote: z.string().trim().max(4000).optional(),
    attachmentKeys: z.array(z.string().trim().min(1).max(300)).max(8).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === PayAdjustmentScope.JOB && !value.jobId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Job is required for job-linked requests.", path: ["jobId"] });
    }
    if (value.scope === PayAdjustmentScope.PROPERTY && !value.propertyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Property is required for property-based requests.",
        path: ["propertyId"],
      });
    }
  });

function getPropertyLabel(input: {
  rowProperty?: { name: string; suburb: string | null } | null;
  rowJobProperty?: { name: string; suburb: string | null } | null;
}) {
  const property = input.rowProperty ?? input.rowJobProperty;
  if (!property) return "No property linked";
  return property.suburb ? `${property.name} (${property.suburb})` : property.name;
}

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
    const status =
      statusRaw && Object.values(PayAdjustmentStatus).includes(statusRaw as PayAdjustmentStatus)
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
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
      },
      orderBy: { requestedAt: "desc" },
    });

    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        attachmentUrls: Array.isArray(row.attachmentKeys)
          ? row.attachmentKeys
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((key) => ({ key, url: publicUrl(key) }))
          : [],
      }))
    );
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

    let linkedJob:
      | {
          id: string;
          jobNumber: string;
          jobType: JobType;
          status: JobStatus;
          propertyId: string;
          property: { id: string; name: string; suburb: string | null; clientId: string };
          assignments: Array<{ userId: string; payRate: number | null; removedAt: Date | null }>;
        }
      | null = null;
    let linkedProperty:
      | {
          id: string;
          name: string;
          suburb: string | null;
          clientId: string;
        }
      | null = null;

    if (body.jobId) {
      linkedJob = await db.job.findUnique({
        where: { id: body.jobId },
        include: {
          property: { select: { id: true, name: true, suburb: true, clientId: true } },
          assignments: {
            select: { userId: true, payRate: true, removedAt: true },
          },
        },
      });
      if (!linkedJob) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
      linkedProperty = {
        id: linkedJob.property.id,
        name: linkedJob.property.name,
        suburb: linkedJob.property.suburb,
        clientId: linkedJob.property.clientId,
      };
      if (linkedJob.status === JobStatus.UNASSIGNED || linkedJob.status === JobStatus.OFFERED) {
        return NextResponse.json(
          { error: "Job-linked pay requests are available only after the job is assigned." },
          { status: 400 }
        );
      }
      const activeAssignment = linkedJob.assignments.find((a) => a.userId === session.user.id && !a.removedAt);
      if (!activeAssignment) {
        return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
      }
    }

    if (body.scope === PayAdjustmentScope.PROPERTY || (body.scope === PayAdjustmentScope.STANDALONE && body.propertyId)) {
      const propertyId = body.propertyId ?? linkedJob?.propertyId;
      linkedProperty = propertyId
        ? await db.property.findUnique({
            where: { id: propertyId },
            select: { id: true, name: true, suburb: true, clientId: true },
          })
        : null;
      if (body.scope === PayAdjustmentScope.PROPERTY && !linkedProperty) {
        return NextResponse.json({ error: "Property not found." }, { status: 404 });
      }
    }

    let requestedHours: number | undefined;
    let requestedRate: number | undefined;
    let requestedAmount: number;

    if (body.type === PayAdjustmentType.HOURLY) {
      requestedHours = Number(body.requestedHours ?? 0);
      if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
        return NextResponse.json({ error: "Requested hours must be greater than 0 for hourly requests." }, { status: 400 });
      }
      const assignmentRate =
        linkedJob?.assignments.find((a) => a.userId === session.user.id && !a.removedAt)?.payRate ?? undefined;
      requestedRate =
        body.requestedRate ??
        assignmentRate ??
        (linkedJob
          ? settings.cleanerJobHourlyRates?.[session.user.id]?.[linkedJob.jobType as JobType]
          : undefined) ??
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
        jobId: linkedJob?.id ?? null,
        propertyId: linkedProperty?.id ?? null,
        cleanerId: session.user.id,
        scope: body.scope,
        title: body.title.trim(),
        type: body.type,
        requestedHours,
        requestedRate,
        requestedAmount,
        cleanerNote: body.cleanerNote?.trim() || undefined,
        attachmentKeys: body.attachmentKeys?.length ? (body.attachmentKeys as any) : undefined,
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
        property: { select: { id: true, name: true, suburb: true } },
      },
    });

    const propertyName = getPropertyLabel({
      rowProperty: created.property,
      rowJobProperty: created.job?.property ?? null,
    });
    const jobReference = created.job ? getJobReference(created.job) : "No job linked";

    const emailTemplate = renderEmailTemplate(settings, "extraPayRequest", {
      cleanerName: session.user.name ?? session.user.email,
      propertyName,
      jobType: created.job?.jobType ? created.job.jobType.replace(/_/g, " ") : body.scope.replace(/_/g, " "),
      jobNumber: jobReference,
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
    const alertSubject = `Cleaner extra pay request (${body.title.trim()})`;
    const notificationTemplate = renderNotificationTemplate(settings, "extraPayRequest", {
      cleanerName: session.user.name ?? session.user.email,
      propertyName,
      jobNumber: jobReference,
      requestType: created.type,
      requestedAmount: `$${created.requestedAmount.toFixed(2)}`,
    });
    const alertBody = notificationTemplate.webBody;
    if (admins.length > 0) {
      await deliverNotificationToRecipients({
        recipients: admins,
        category: "approvals",
        jobId: created.job?.id ?? undefined,
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
        jobId: created.job?.id ?? undefined,
        channel: NotificationChannel.EMAIL,
        subject: "Extra payment request sent to admin",
        body: `Request ${created.id} submitted for admin review.`,
        status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: emailResult.ok ? new Date() : undefined,
        errorMsg: emailResult.ok ? undefined : emailResult.error ?? "Email provider failure.",
      },
    });

    return NextResponse.json(
      {
        ...created,
        attachmentUrls: Array.isArray(created.attachmentKeys)
          ? created.attachmentKeys
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((key) => ({ key, url: publicUrl(key) }))
          : [],
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not submit request." }, { status });
  }
}
