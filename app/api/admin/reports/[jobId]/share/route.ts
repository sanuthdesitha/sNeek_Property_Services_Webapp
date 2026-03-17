import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generateJobReport, REPORT_TEMPLATE_VERSION } from "@/lib/reports/generator";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { z } from "zod";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]).optional(),
});

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

    let report = await db.report.findUnique({ where: { jobId: params.jobId } });
    const hasCurrentTemplate = report?.htmlContent?.includes(
      `report-template:${REPORT_TEMPLATE_VERSION}`
    );
    if (!report || !hasCurrentTemplate) {
      await generateJobReport(params.jobId);
      report = await db.report.findUnique({ where: { jobId: params.jobId } });
    }
    if (!report) {
      return NextResponse.json({ error: "Report is not available for sharing." }, { status: 404 });
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
    const reportLink = report.pdfUrl || resolveAppUrl(`/api/reports/${params.jobId}/download`, req);
    const emailTemplate = renderEmailTemplate(settings, "cleaningReportShared", {
      clientName: job.property.client?.name ?? "Client",
      propertyName: job.property.name,
      reportLink,
    });
    const sentResult = await sendEmailDetailed({
      to: recipients,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });
    const sent = sentResult.ok;

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject: emailTemplate.subject,
        body: `Report ${params.jobId} sent to ${recipients.join(", ")}`,
        status: sent ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: sent ? new Date() : undefined,
        errorMsg: sent ? undefined : sentResult.error ?? "Email provider failed to deliver report.",
      },
    });

    if (!sent) {
      return NextResponse.json({ error: sentResult.error ?? "Email provider failed to send report." }, { status: 502 });
    }

    await db.report.update({
      where: { jobId: params.jobId },
      data: { sentToClient: true, sentAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
