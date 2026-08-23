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

    // PAID and VOID are terminal, and this route was ignoring that — it set
    // SENT unconditionally. So sending a voided invoice moved it back to SENT,
    // putting a cancelled document back into the client's outstanding balance
    // and into the receivables figure. Emailing a PAID one does the same in
    // reverse: the payment stamps survive on a row the rest of the system now
    // reads as unpaid.
    if (
      invoice.status === ClientInvoiceStatus.VOID ||
      invoice.status === ClientInvoiceStatus.PAID
    ) {
      return NextResponse.json(
        {
          error:
            invoice.status === ClientInvoiceStatus.VOID
              ? "This invoice is void. Generate a replacement rather than sending it again."
              : "This invoice is already paid. Sending it again would reopen it as unpaid.",
        },
        { status: 409 }
      );
    }

    // Chasing a PARTLY PAID invoice by emailing it again is routine, so the
    // send is allowed — but the status must NOT move. Writing SENT here would
    // discard the fact that money has already come in against it, which is
    // exactly what the graph refuses when it says PART_PAID cannot go back to
    // SENT. Only `sentAt` is restamped.
    const keepsStatus = invoice.status === ClientInvoiceStatus.PART_PAID;

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

    const pdf = await renderClientInvoicePdf(invoice, settings.companyName || "sNeek Property Services", settings.logoUrl || settings.reportLogoUrl, settings.invoicing);
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
      // A finance document the admin explicitly sent — a stale suppression
      // must not silently eat an invoice.
      transactional: true,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Email provider failed." }, { status: 502 });
    }

    await db.clientInvoice.update({
      where: { id: invoice.id },
      data: {
        ...(keepsStatus ? {} : { status: ClientInvoiceStatus.SENT }),
        sentAt: new Date(),
      },
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
