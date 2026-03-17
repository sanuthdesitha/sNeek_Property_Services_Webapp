import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  buildShoppingRunPurchaseOrderHtml,
  getShoppingRunByIdForAdmin,
  renderShoppingRunPdf,
} from "@/lib/inventory/shopping-runs";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]),
  supplier: z.string().trim().optional(),
  subject: z.string().trim().max(200).optional(),
  orderReference: z.string().trim().max(80).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const run = await getShoppingRunByIdForAdmin(params.id);
    if (!run) {
      return NextResponse.json({ error: "Shopping run not found." }, { status: 404 });
    }

    const settings = await getAppSettings();
    const html = buildShoppingRunPurchaseOrderHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      run,
      supplier: body.supplier?.trim() || undefined,
      orderReference: body.orderReference?.trim() || undefined,
    });
    let pdf: Buffer;
    try {
      pdf = await renderShoppingRunPdf(html);
    } catch {
      return NextResponse.json(
        { error: "PDF generation failed. Ensure Playwright browsers are installed." },
        { status: 500 }
      );
    }

    const to = Array.isArray(body.to) ? body.to : [body.to];
    const subject =
      body.subject?.trim() ||
      `Purchase Order - ${run.name}${body.supplier?.trim() ? ` (${body.supplier.trim()})` : ""}`;
    const sentResult = await sendEmailDetailed({
      to,
      subject,
      html: `
        <p>Please find the attached purchase order.</p>
        <p><strong>Run:</strong> ${run.name}</p>
        ${body.supplier?.trim() ? `<p><strong>Supplier:</strong> ${body.supplier.trim()}</p>` : ""}
      `,
      attachments: [
        {
          filename: `purchase-order-${run.id}.pdf`,
          content: pdf,
        },
      ],
    });
    const ok = sentResult.ok;

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject,
        body: `PO email for shopping run ${run.id} sent to ${to.join(", ")}`,
        status: ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: ok ? new Date() : undefined,
        errorMsg: ok ? undefined : sentResult.error ?? "Email provider failed to send PO.",
      },
    });

    if (!ok) {
      return NextResponse.json(
        { error: sentResult.error ?? "Email provider failed to send PO." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Email failed." }, { status });
  }
}
