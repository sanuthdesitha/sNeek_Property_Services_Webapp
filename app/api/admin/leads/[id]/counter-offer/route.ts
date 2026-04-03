import { NextRequest, NextResponse } from "next/server";
import { LeadStatus, QuoteStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

const lineItemSchema = z.object({
  label: z.string().trim().min(1).max(240),
  unitPrice: z.number().finite(),
  qty: z.number().finite().positive(),
  total: z.number().finite(),
});

const requestSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1),
  notes: z.string().trim().max(12000).optional(),
  validUntil: z.string().datetime().optional(),
  sendEmail: z.boolean().default(true),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = requestSchema.parse(await req.json().catch(() => ({})));

    const lead = await db.quoteLead.findUnique({
      where: { id: params.id },
      include: { client: { select: { id: true, name: true, email: true } } },
    });
    if (!lead) {
      return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    }

    const subtotal = body.lineItems.reduce((sum, item) => sum + Number(item.total ?? item.unitPrice * item.qty), 0);
    const gstAmount = Number((subtotal * 0.1).toFixed(2));
    const totalAmount = Number((subtotal + gstAmount).toFixed(2));

    const quote = await db.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: {
          leadId: lead.id,
          clientId: lead.clientId ?? undefined,
          serviceType: lead.serviceType,
          lineItems: body.lineItems,
          subtotal,
          gstAmount,
          totalAmount,
          notes: body.notes || lead.notes || undefined,
          validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
          status: body.sendEmail ? QuoteStatus.SENT : QuoteStatus.DRAFT,
        },
      });

      await tx.quoteLead.update({
        where: { id: lead.id },
        data: { status: LeadStatus.QUOTED },
      });

      return created;
    });

    if (body.sendEmail) {
      const settings = await getAppSettings();
      const html = buildQuoteHtml(
        {
          ...quote,
          createdAt: quote.createdAt,
          lead: { name: lead.name, email: lead.email },
          client: lead.client ? { name: lead.client.name, email: lead.client.email } : null,
        },
        {
          companyName: settings.companyName,
          logoUrl: settings.logoUrl,
        }
      );
      const emailResult = await sendEmailDetailed({
        to: lead.email,
        subject: `Counter offer for ${lead.name}`,
        html,
      });
      if (!emailResult.ok) {
        return NextResponse.json(
          { error: emailResult.error ?? "Quote was created but the email provider failed." },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ quoteId: quote.id });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create counter offer." }, { status });
  }
}
