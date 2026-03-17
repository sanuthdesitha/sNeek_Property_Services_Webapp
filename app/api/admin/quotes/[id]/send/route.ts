import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, QuoteStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { getAppSettings } from "@/lib/settings";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { z } from "zod";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]).optional(),
  subject: z.string().trim().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    const quote = await db.quote.findUnique({
      where: { id: params.id },
      include: {
        client: { select: { id: true, name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
    });
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (quote.status === QuoteStatus.DRAFT && session.user.role !== Role.ADMIN) {
      return NextResponse.json(
        { error: "Admin approval is required before sending a draft quote." },
        { status: 403 }
      );
    }

    const explicitRecipients = body.to
      ? Array.isArray(body.to)
        ? body.to
        : [body.to]
      : [];
    const profileRecipients =
      explicitRecipients.length > 0
        ? explicitRecipients
        : await resolveClientDeliveryRecipients({
            clientId: quote.client?.id,
            fallbackEmail: quote.client?.email ?? null,
            kind: "invoice",
          });
    const recipients = profileRecipients.length
      ? profileRecipients
      : quote.lead?.email
        ? [quote.lead.email]
        : [];

    if (!recipients.length) {
      return NextResponse.json({ error: "No recipient email found. Please provide an email address." }, { status: 400 });
    }

    const settings = await getAppSettings();
    const subject = body.subject || settings.quoteDefaultEmailSubject;
    const html = buildQuoteHtml(quote, {
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
    });

    const sentResult = await sendEmailDetailed({
      to: recipients,
      subject,
      html,
    });
    const sent = sentResult.ok;

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject,
        body: `Quote ${quote.id} sent to ${recipients.join(", ")}`,
        status: sent ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: sent ? new Date() : undefined,
        errorMsg: sent ? undefined : sentResult.error ?? "Email provider returned failure.",
      },
    });

    if (!sent) {
      return NextResponse.json({ error: sentResult.error ?? "Email provider failed to send quote." }, { status: 502 });
    }

    await db.quote.update({
      where: { id: quote.id },
      data: {
        status: quote.status === QuoteStatus.DRAFT ? QuoteStatus.SENT : quote.status,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
