import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus, NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice, renderClientInvoicePdf } from "@/lib/billing/client-invoices";
import { getAppSettings } from "@/lib/settings";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { renderEmailTemplate } from "@/lib/email-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [invoice, settings] = await Promise.all([getClientInvoice(params.id), getAppSettings()]);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const explicitTo = typeof body?.to === "string" ? body.to.trim() : "";
    const recipients = explicitTo
      ? [explicitTo]
      : await resolveClientDeliveryRecipients({
          clientId: invoice.clientId,
          fallbackEmail: invoice.client.email ?? null,
          kind: "invoice",
        });
    if (!recipients.length) {
      return NextResponse.json({ error: "No invoice recipient email found." }, { status: 400 });
    }

    const pdf = await renderClientInvoicePdf(invoice, settings.companyName || "sNeek Property Services", settings.logoUrl, settings.invoicing);
    const template = renderEmailTemplate(settings, "clientInvoiceIssued", {
      clientName: invoice.client.name,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount.toFixed(2),
      actionLabel: "View invoice",
      actionUrl: `${req.nextUrl.origin}/admin/invoices`,
    });

    const result = await sendEmailDetailed({
      to: recipients,
      subject: template.subject,
      html: template.html,
      attachments: [
        {
          filename: `${invoice.invoiceNumber.toLowerCase()}.pdf`,
          content: pdf,
        },
      ],
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Email provider failed." }, { status: 502 });
    }

    await db.clientInvoice.update({
      where: { id: invoice.id },
      data: { status: ClientInvoiceStatus.SENT, sentAt: new Date() },
    });

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject: template.subject,
        body: `Invoice ${invoice.invoiceNumber} sent to ${recipients.join(", ")}`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not send invoice." }, { status: 400 });
  }
}
