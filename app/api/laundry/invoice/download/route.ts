import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import {
  buildLaundryInvoiceHtml,
  getLaundryInvoiceData,
  getLaundryInvoiceTemplate,
  renderLaundryInvoicePdf,
  saveLaundryInvoiceTemplate,
  LaundryInvoicePeriod,
} from "@/lib/laundry/invoice";
import { isLaundryModuleEnabled } from "@/lib/portal-access";
import { logLaundryReportActivity } from "@/lib/laundry/report-history";

const bodySchema = z.object({
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
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.LAUNDRY) {
      const settings = await getAppSettings();
      if (!isLaundryModuleEnabled(settings, "invoices")) {
        return NextResponse.json({ error: "Invoices are not available for laundry users." }, { status: 403 });
      }
    }
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
    await logLaundryReportActivity({
      userId: session.user.id,
      action: "DOWNLOAD",
      data,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    const filename = body.taskId
      ? `laundry-job-${body.taskId}.pdf`
      : `laundry-invoice-${data.start.toISOString().slice(0, 10)}-to-${data.end
          .toISOString()
          .slice(0, 10)}${data.propertyId ? `-${data.propertyId}` : ""}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
