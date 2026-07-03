import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createQuoteSchema } from "@/lib/validations/quote";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";

/**
 * Warn (never block) when a quote's net price falls below the configured margin
 * floor — the admin path is "warn but allow" (the public path auto-clamps).
 * Uses the same model as the pricing calculator's margin-floor guard: cost is
 * `positiveSubtotal × costShare`, and the floor price is `cost / (1 - floor%)`.
 * Discounts show up as negative line items, so `positiveSubtotal` is the price
 * before discounts and `netSubtotal` is what's actually charged.
 */
async function computeMarginFloorWarning(
  lineItems: Array<{ total?: number | null }> | undefined,
  netSubtotal: number
): Promise<string | null> {
  const pricing = (await getAppSettings()).pricing;
  const costShare =
    pricing.rackHourlyRate > 0
      ? Math.min(0.95, pricing.cleanerHourlyCost / pricing.rackHourlyRate)
      : 0;
  if (costShare <= 0) return null;
  const positiveSubtotal = (lineItems ?? []).reduce(
    (sum, li) => sum + Math.max(0, Number(li?.total ?? 0)),
    0
  );
  if (positiveSubtotal <= 0) return null;
  const floorPct = pricing.marginFloorPercent ?? 40;
  const floorDivisor = Math.max(0.05, 1 - floorPct / 100);
  const floorPrice = Number(((positiveSubtotal * costShare) / floorDivisor).toFixed(2));
  if (netSubtotal >= floorPrice) return null;
  return `This quote's price ($${netSubtotal.toFixed(
    2
  )}) is below the ${floorPct}% margin floor (min $${floorPrice.toFixed(
    2
  )}). Sending anyway.`;
}

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

    const quote = await db.quote.create({ data: { ...quoteData, leadId } });
    const marginWarning = await computeMarginFloorWarning(
      quoteData.lineItems as Array<{ total?: number | null }> | undefined,
      Number(quoteData.subtotal ?? 0)
    );
    return NextResponse.json(
      marginWarning ? { ...quote, marginWarning } : quote,
      { status: 201 }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
