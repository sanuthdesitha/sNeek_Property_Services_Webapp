import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createQuoteSchema } from "@/lib/validations/quote";
import { getAppSettings } from "@/lib/settings";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { Role } from "@prisma/client";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const quotes = await db.quote.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json(quotes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { newLead, ...quoteData } = createQuoteSchema.parse(await req.json());

    let leadId = quoteData.leadId;
    // A brand-new recipient with their details → create the lead, link it.
    if (newLead) {
      const lead = await db.quoteLead.create({
        data: {
          name: newLead.name,
          email: newLead.email.toLowerCase(),
          phone: newLead.phone || null,
          suburb: newLead.suburb || null,
          serviceType: quoteData.serviceType,
          status: "QUOTED",
        },
      });
      leadId = lead.id;
    }

    // Never trust client money: recompute each line total (unit × qty), the
    // subtotal, and GST on the server so the saved totals always agree with the
    // line items and the configured GST setting.
    const settings = await getAppSettings();
    const lineItems = quoteData.lineItems.map((li) => ({
      ...li,
      total: Number((Number(li.unitPrice) * Number(li.qty)).toFixed(2)),
    }));
    const computedSubtotal = Number(lineItems.reduce((sum, li) => sum + li.total, 0).toFixed(2));
    const { subtotal, gstAmount, totalAmount } = calculateGstBreakdown(Math.max(0, computedSubtotal), {
      gstEnabled: settings.pricing.gstEnabled,
    });

    const quote = await db.quote.create({
      data: { ...quoteData, leadId, lineItems, subtotal, gstAmount, totalAmount },
    });
    return NextResponse.json(quote, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
