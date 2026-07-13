import { NextRequest, NextResponse } from "next/server";
import { QuoteStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { validateDiscountCampaign, applyCampaignDiscount } from "@/lib/marketing/campaigns";
import { getMarketingCampaigns, saveMarketingCampaigns } from "@/lib/marketing/store";
import { isMarketedJobType } from "@/lib/marketing/job-types";
import { recordQuoteEvent } from "@/lib/quotes/events";

export const dynamic = "force-dynamic";

type LineItem = { label: string; unitPrice: number; qty: number; total: number };

const bodySchema = z
  .object({
    // Apply a coupon by code (validated against DiscountCampaigns)…
    code: z.string().trim().min(1).max(60).optional(),
    // …or a manual dollar discount…
    amount: z.number().min(0).max(1_000_000).optional(),
    label: z.string().trim().max(80).optional(),
    // …or clear whatever discount is on the quote.
    clear: z.boolean().optional(),
  })
  .refine((b) => b.clear || b.code || typeof b.amount === "number", {
    message: "Provide a coupon code, a discount amount, or clear.",
  });

function parseLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LineItem[] = [];
  for (const item of raw) {
    const e = (item ?? {}) as Record<string, unknown>;
    const label = String(e.label ?? "").trim();
    if (!label) continue;
    out.push({
      label: label.slice(0, 300),
      unitPrice: Number(e.unitPrice) || 0,
      qty: Number(e.qty) || 0,
      total: Number(e.total) || 0,
    });
  }
  return out;
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Move a coupon's usage count between the old and new code through the
 * marketing store (coupons live in an AppSetting blob, not a table). One
 * read-modify-write so a swap can't double-persist. Best-effort.
 */
async function adjustCouponUsage(oldCode: string | null, newCode: string | null) {
  if (oldCode === newCode) return;
  try {
    const campaigns = await getMarketingCampaigns();
    let changed = false;
    const next = campaigns.map((c) => {
      if (newCode && c.code === newCode) {
        changed = true;
        return { ...c, usageCount: c.usageCount + 1 };
      }
      if (oldCode && c.code === oldCode) {
        changed = true;
        return { ...c, usageCount: Math.max(0, c.usageCount - 1) };
      }
      return c;
    });
    if (changed) await saveMarketingCampaigns(next);
  } catch {
    // usage accounting is non-critical
  }
}

/**
 * POST — apply / replace / clear a quote discount. Discounts are stored as a
 * negative line item (matching this codebase's convention), so they flow into
 * the totals, the emailed/printed quote, and the public online quote with no
 * extra plumbing. Coupons are validated against the live DiscountCampaigns.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const quote = await db.quote.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, serviceType: true, lineItems: true, discountCode: true },
    });
    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (quote.status === QuoteStatus.CONVERTED) {
      return NextResponse.json(
        { error: "This quote has been converted to a job and can no longer be edited." },
        { status: 400 }
      );
    }

    // Strip any existing discount line(s) — a discount is the negative-total line.
    const positiveLines = parseLineItems(quote.lineItems).filter((li) => li.total >= 0);
    const positiveSubtotal = round2(positiveLines.reduce((s, li) => s + (Number(li.total) || 0), 0));

    let discountAmount = 0;
    let discountLabel: string | null = null;
    let newCode: string | null = null;

    if (!body.clear) {
      if (body.code) {
        const marketedType = isMarketedJobType(String(quote.serviceType))
          ? (String(quote.serviceType) as Parameters<typeof validateDiscountCampaign>[1])
          : undefined;
        const result = await validateDiscountCampaign(body.code, marketedType, positiveSubtotal);
        if (!result.valid) {
          return NextResponse.json({ error: result.reason }, { status: 400 });
        }
        discountAmount = round2(
          Math.min(positiveSubtotal, applyCampaignDiscount(positiveSubtotal, result.campaign))
        );
        if (discountAmount <= 0) {
          return NextResponse.json({ error: "This coupon produces no discount on this quote." }, { status: 400 });
        }
        newCode = result.campaign.code;
        discountLabel = `Discount · ${result.campaign.title} (${result.campaign.code})`;
      } else {
        // Manual discount.
        discountAmount = round2(Math.min(positiveSubtotal, Math.max(0, Number(body.amount) || 0)));
        if (discountAmount <= 0) {
          return NextResponse.json({ error: "Enter a discount greater than $0." }, { status: 400 });
        }
        discountLabel = body.label?.trim() ? `Discount · ${body.label.trim()}` : "Discount";
      }
    }

    const lineItems: LineItem[] = [...positiveLines];
    if (discountAmount > 0 && discountLabel) {
      lineItems.push({ label: discountLabel, unitPrice: -discountAmount, qty: 1, total: -discountAmount });
    }
    const newSubtotal = round2(positiveSubtotal - discountAmount);

    const settings = await getAppSettings();
    const totals = calculateGstBreakdown(newSubtotal, { gstEnabled: settings.pricing.gstEnabled });

    // Usage accounting: move the count off the old coupon and onto the new one.
    await adjustCouponUsage(quote.discountCode, newCode);

    await db.quote.update({
      where: { id: quote.id },
      data: {
        lineItems: lineItems as unknown as object,
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        totalAmount: totals.totalAmount,
        discountCode: newCode,
      },
    });

    await recordQuoteEvent(quote.id, "NOTE", {
      note: body.clear
        ? "Removed discount from quote"
        : `Applied ${discountLabel} (−$${discountAmount.toFixed(2)})`,
    });

    return NextResponse.json({
      ok: true,
      subtotal: totals.subtotal,
      gstAmount: totals.gstAmount,
      totalAmount: totals.totalAmount,
      discountCode: newCode,
      discountLabel,
      discountAmount,
      lineItems,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
