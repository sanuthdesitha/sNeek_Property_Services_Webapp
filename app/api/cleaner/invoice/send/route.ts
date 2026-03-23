import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { renderEmailTemplate } from "@/lib/email-templates";
import {
  buildCleanerInvoiceHtml,
  getCleanerInvoiceData,
  renderCleanerInvoicePdf,
} from "@/lib/cleaner/invoice";
import { markCleanerShoppingRunsInvoiced } from "@/lib/inventory/shopping-runs";

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  showSpentHours: z.boolean().optional(),
  jobComments: z.record(z.string(), z.string()).optional(),
  jobHourOverrides: z.record(z.string(), z.number().nonnegative()).optional(),
  confirmEmail: z.literal(true),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "invoices")) {
      return NextResponse.json({ error: "Invoices are disabled for cleaners." }, { status: 403 });
    }
    const body = schema.parse(await req.json().catch(() => ({})));
    const data = await getCleanerInvoiceData({
      userId: session.user.id,
      startDate: body.startDate,
      endDate: body.endDate,
      showSpentHours: body.showSpentHours,
      jobComments: body.jobComments,
      jobHourOverrides: body.jobHourOverrides,
    });
    if (data.estimatedPay <= 0 && data.pendingAdjustmentCount > 0) {
      return NextResponse.json(
        {
          error:
            "Invoice total is $0.00 while there are pending extra payment requests waiting for admin approval. Wait for those approvals before emailing accounts.",
          pendingAdjustmentCount: data.pendingAdjustmentCount,
          pendingAdjustmentAmount: data.pendingAdjustmentAmount,
        },
        { status: 409 }
      );
    }

    const accountsEmail = settings.accountsEmail;
    if (!accountsEmail) {
      return NextResponse.json({ error: "Accounts email is not configured." }, { status: 400 });
    }
    const html = buildCleanerInvoiceHtml(data);
    const pdf = await renderCleanerInvoicePdf(html);
    const fileName = `cleaner-invoice-${session.user.id}-${data.start.toISOString().slice(0, 10)}-to-${data.end
      .toISOString()
      .slice(0, 10)}.pdf`;

    const emailTemplate = renderEmailTemplate(settings, "cleanerInvoice", {
      cleanerName: data.cleanerName,
      accountsEmail,
      jobCount: data.rows.length,
    });
    const emailResult = await sendEmailDetailed({
      to: accountsEmail,
      subject: emailTemplate.subject,
      html: `${emailTemplate.html}${html}`,
      attachments: [{ filename: fileName, content: pdf }],
    });

    if (!emailResult.ok) {
      return NextResponse.json({ error: emailResult.error ?? "Failed to send invoice email." }, { status: 502 });
    }

    await markCleanerShoppingRunsInvoiced({
      cleanerId: session.user.id,
      runIds: Array.from(
        new Set([
          ...data.expenseRows.map((row) => row.runId),
          ...data.shoppingTimeRows.map((row) => row.runId),
        ])
      ),
    });

    return NextResponse.json({
      ok: true,
      hours: data.hours,
      estimatedPay: data.estimatedPay,
      sentTo: accountsEmail,
      jobs: data.rows.length,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
