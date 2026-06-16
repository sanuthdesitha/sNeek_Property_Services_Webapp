import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { publicQuoteSchema } from "@/lib/validations/quote";
import { calculateQuote } from "@/lib/pricing/calculator";

/**
 * Admin live pricing: runs the rate-card calculator (PriceBook + add-ons +
 * condition/frequency multipliers + promo, with the margin-floor guard) and
 * returns line items + totals so the quote builder can auto-fill from the
 * editable rate card. Service types that need a manual quote come back with
 * requiresManualQuote so the builder falls back to manual line items.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const input = publicQuoteSchema.parse(await req.json());
    const result = await calculateQuote(input as any);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    if (err.code === "INVALID_CAMPAIGN") {
      return NextResponse.json({ error: err.message ?? "Invalid promo code." }, { status: 400 });
    }
    if (err.code === "NO_PRICEBOOK_MATCH" || err.code === "MANUAL_REVIEW" || err.code === "MANUAL_QUOTE") {
      return NextResponse.json({
        ok: false,
        requiresManualQuote: true,
        message: "This service needs a manual quote — add line items by hand.",
      });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not price quote." }, { status });
  }
}
