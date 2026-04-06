import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { resolveAppUrl } from "@/lib/app-url";

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_API_KEY?.trim() || "";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const stripeKey = getStripeSecretKey();
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }

    const invoice = await db.clientInvoice.findFirst({
      where: {
        id: params.id,
        clientId: user.clientId,
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    if (
      invoice.status !== ClientInvoiceStatus.SENT &&
      invoice.status !== ClientInvoiceStatus.APPROVED
    ) {
      return NextResponse.json({ error: "This invoice cannot be paid online." }, { status: 400 });
    }

    const settings = await getPhase3IntegrationsSettings();
    if (!settings.stripe.enabled) {
      return NextResponse.json({ error: "Stripe payments are disabled." }, { status: 400 });
    }

    const successUrl = settings.stripe.successUrl || resolveAppUrl("/client/finance?paid=1", req);
    const cancelUrl = settings.stripe.cancelUrl || resolveAppUrl("/client/finance", req);
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("payment_method_types[0]", "card");
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", settings.stripe.currency || "aud");
    form.set("line_items[0][price_data][product_data][name]", `Invoice ${invoice.invoiceNumber}`);
    form.set("line_items[0][price_data][unit_amount]", String(Math.round(Number(invoice.totalAmount ?? 0) * 100)));
    form.set("metadata[invoiceId]", invoice.id);
    form.set("metadata[clientId]", user.clientId);
    form.set("invoice_creation[enabled]", "true");
    if (settings.stripe.statementDescriptor) {
      form.set("payment_intent_data[statement_descriptor]", settings.stripe.statementDescriptor);
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload?.url !== "string") {
      return NextResponse.json(
        { error: payload?.error?.message ?? "Stripe did not return a checkout URL." },
        { status: 400 }
      );
    }

    return NextResponse.json({ url: payload.url });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not create payment link." }, { status });
  }
}
