import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  buildLaundryInvoiceHtml,
  getLaundryInvoiceData,
  getLaundryInvoiceTemplate,
  renderLaundryInvoicePdf,
  saveLaundryInvoiceTemplate,
  LaundryInvoicePeriod,
} from "@/lib/laundry/invoice";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { logLaundryReportActivity } from "@/lib/laundry/report-history";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";

const bodySchema = z.object({
  to: z.string().trim().email(),
  period: z.enum(["daily", "weekly", "monthly", "annual", "custom"]).optional(),
  anchorDate: z.string().date().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  propertyId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional(),
  template: z
    .object({
      companyName: z.string().trim().min(1).max(200).optional(),
      invoiceTitle: z.string().trim().min(1).max(200).optional(),
      footerNote: z.string().trim().max(4000).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    let template = await getLaundryInvoiceTemplate(session.user.id);
    if (body.template && Object.keys(body.template).length > 0) {
      template = await saveLaundryInvoiceTemplate(session.user.id, body.template);
    }

    const data = await getLaundryInvoiceData({
      period: body.period as LaundryInvoicePeriod | undefined,
      anchorDate: body.anchorDate,
      startDate: body.startDate,
      endDate: body.endDate,
      propertyId: body.propertyId,
      taskId: body.taskId,
    });

    const html = buildLaundryInvoiceHtml({ data, template });
    const pdf = await renderLaundryInvoicePdf(html);
    const filename = body.taskId
      ? `laundry-job-${body.taskId}.pdf`
      : `laundry-report-${data.start.toISOString().slice(0, 10)}-to-${data.end.toISOString().slice(0, 10)}.pdf`;
    const settings = await getAppSettings();
    const reportLabel = body.taskId
      ? data.propertyName ?? "Laundry job"
      : `${data.start.toLocaleDateString("en-AU")} to ${data.end.toLocaleDateString("en-AU")}`;
    const emailTemplate = renderEmailTemplate(settings, "laundryReport", {
      recipientName: body.to,
      reportLabel,
      propertyName: data.propertyName ?? "Multiple properties",
    });

    const sent = await sendEmailDetailed({
      to: body.to,
      subject: emailTemplate.subject,
      html: `${emailTemplate.html}${html}`,
      attachments: [{ filename, content: pdf }],
    });

    if (!sent.ok) {
      return NextResponse.json({ error: sent.error ?? "Could not send report email." }, { status: 400 });
    }

    await logLaundryReportActivity({
      userId: session.user.id,
      action: "EMAIL",
      data,
      recipient: body.to,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
