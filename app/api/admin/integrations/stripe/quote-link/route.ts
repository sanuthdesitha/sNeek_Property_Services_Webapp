import { NextRequest, NextResponse } from "next/server";
import { QuoteStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";

const schema = z.object({
  quoteId: z.string().trim().min(1),
  customerEmail: z.string().trim().email().optional(),
});

function toCents(amount: number) {
  return Math.max(0, Math.round(amount * 100));
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const [settings, quote] = await Promise.all([
      getPhase3IntegrationsSettings(),
      db.quote.findUnique({
        where: { id: body.quoteId },
        include: {
          client: { select: { email: true, name: true } },
          lead: { select: { email: true, name: true } },
        },
      }),
    ]);

    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (!settings.stripe.enabled) {
      return NextResponse.json({ error: "Stripe integration is disabled in settings." }, { status: 400 });
    }
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY in environment." }, { status: 500 });
    }

    const recipient = body.customerEmail || quote.client?.email || quote.lead?.email || undefined;
    const amountCents = toCents(Number(quote.totalAmount || 0));
    if (amountCents <= 0) {
      return NextResponse.json({ error: "Quote total amount must be greater than zero." }, { status: 400 });
    }

    const form = new URLSearchParams();
    form.set("line_items[0][price_data][currency]", settings.stripe.currency);
    form.set("line_items[0][price_data][product_data][name]", `Quote ${quote.id}`);
    form.set(
      "line_items[0][price_data][product_data][description]",
      `${String(quote.serviceType).replace(/_/g, " ")} service quote`
    );
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][quantity]", "1");
    form.set("metadata[quote_id]", quote.id);
    if (recipient) form.set("metadata[customer_email]", recipient);
    if (settings.stripe.successUrl) {
      form.set("after_completion[type]", "redirect");
      form.set("after_completion[redirect][url]", settings.stripe.successUrl);
    }

    const response = await fetch("https://api.stripe.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        "Stripe API failed to create payment link.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    if (quote.status === QuoteStatus.DRAFT) {
      await db.quote.update({
        where: { id: quote.id },
        data: { status: QuoteStatus.SENT },
      });
    }

    return NextResponse.json({
      ok: true,
      paymentLink: payload?.url ?? null,
      stripeId: payload?.id ?? null,
      quoteId: quote.id,
      amount: quote.totalAmount,
      currency: settings.stripe.currency,
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create Stripe payment link." }, { status });
  }
}

