import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { priceService } from "@/lib/pricing/service-catalog";
import { getServicePricing } from "@/lib/pricing/service-pricing-store";
import { calculateGstBreakdown } from "@/lib/pricing/gst";

/**
 * Admin live pricing for the quote builder. Prices a service from its OWN model
 * (rooms / area / windows / items / bands / hourly) using the editable per-type
 * rates, then applies GST. Returns line items + totals.
 */
const schema = z.object({
  serviceType: z.string().min(1),
  bedrooms: z.number().min(0).max(50).optional(),
  bathrooms: z.number().min(0).max(50).optional(),
  sqm: z.number().min(0).max(100000).optional(),
  windows: z.number().min(0).max(2000).optional(),
  items: z.number().min(0).max(500).optional(),
  hours: z.number().min(0).max(1000).optional(),
  bandIndex: z.number().min(0).max(20).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const [pricing, settings] = await Promise.all([getServicePricing(), getAppSettings()]);
    const rate = pricing[body.serviceType];

    const { lineItems, subtotal } = priceService(body.serviceType, body, rate);
    if (lineItems.length === 0) {
      return NextResponse.json({
        ok: false,
        requiresManualQuote: true,
        message: "This service needs manual line items.",
      });
    }
    const totals = calculateGstBreakdown(subtotal, { gstEnabled: settings.pricing.gstEnabled });
    return NextResponse.json({
      ok: true,
      result: { lineItems, subtotal: totals.subtotal, gst: totals.gstAmount, total: totals.totalAmount },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not price quote." }, { status });
  }
}
