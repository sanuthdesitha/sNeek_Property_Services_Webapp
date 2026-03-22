import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { z } from "zod";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { getStoredJobReport } from "@/lib/reports/access";
import { getJobReportPdfBuffer } from "@/lib/reports/pdf";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getJobReference } from "@/lib/jobs/job-number";
import { generateJobReport } from "@/lib/reports/generator";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]).optional(),
});

const TZ = "Australia/Sydney";

async function buildReportAttachment(
  report: { pdfUrl: string | null; htmlContent: string | null },
  jobId: string,
  jobNumber: string
) {
  try {
    const pdf = await getJobReportPdfBuffer(report, jobId);
    if (!pdf) return null;
    return {
      filename: `${jobNumber.toLowerCase()}-report.pdf`,
      content: pdf,
      contentType: "application/pdf",
    };
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    const job = await db.job.findUnique({
      where: { id: params.jobId },
      include: {
        property: {
          include: {
            client: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const report = await getStoredJobReport(params.jobId);
    if (!report) {
      generateJobReport(params.jobId).catch(() => {});
      return NextResponse.json(
        { error: "Report is being generated. Try again shortly." },
        { status: 202 }
      );
    }

    const explicitRecipients = body.to
      ? Array.isArray(body.to)
        ? body.to
        : [body.to]
      : [];
    const recipients =
      explicitRecipients.length > 0
        ? explicitRecipients
        : await resolveClientDeliveryRecipients({
            clientId: job.property.client?.id ?? null,
            fallbackEmail: job.property.client?.email ?? null,
            kind: "report",
          });
    if (!recipients.length) {
      return NextResponse.json(
        { error: "No client email found. Add a client email or provide a recipient." },
        { status: 400 }
      );
    }

    const settings = await getAppSettings();
    const clientPortalUrl = resolveAppUrl("/client/reports", req);
    const emailTemplate = renderEmailTemplate(settings, "cleaningReportShared", {
      clientName: job.property.client?.name ?? "Client",
      jobNumber: getJobReference(job),
      propertyName: job.property.name,
      jobType: job.jobType.replace(/_/g, " "),
      cleanDate: format(toZonedTime(job.scheduledDate, TZ), "EEEE, dd MMMM yyyy"),
      reportLink: clientPortalUrl,
      actionUrl: clientPortalUrl,
      actionLabel: "Open client portal",
    });

    const attachment = report.pdfUrl
      ? await buildReportAttachment(report, params.jobId, getJobReference(job))
      : null;
    if (!attachment) {
      generateJobReport(params.jobId).catch(() => {});
      return NextResponse.json(
        {
          error: "Report PDF is being generated. Try again shortly.",
        },
        { status: 202 }
      );
    }

    const sentResult = await sendEmailDetailed({
      to: recipients,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      attachments: [attachment],
    });
    const sent = sentResult.ok;

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject: emailTemplate.subject,
        body: `Report ${getJobReference(job)} sent to ${recipients.join(", ")}`,
        status: sent ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: sent ? new Date() : undefined,
        errorMsg: sent
          ? undefined
          : sentResult.error ?? "Email provider failed to deliver report.",
      },
    });

    if (!sent) {
      return NextResponse.json({ error: sentResult.error ?? "Email provider failed to send report." }, { status: 502 });
    }

    await db.report.update({
      where: { jobId: params.jobId },
      data: { sentToClient: true, sentAt: new Date() },
    });

    return NextResponse.json({ ok: true, attachedPdf: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
