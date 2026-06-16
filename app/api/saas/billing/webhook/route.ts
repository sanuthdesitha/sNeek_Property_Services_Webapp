import { NextRequest, NextResponse } from "next/server";
import { verifyBillingSignature, handleBillingEvent } from "@/lib/saas/billing";
import { BILLING_ENABLED } from "@/lib/saas/config";

/**
 * Stripe SaaS-billing webhook (separate from /api/webhooks/stripe, which is for
 * tenant client-invoices). Verifies the signature against
 * STRIPE_BILLING_WEBHOOK_SECRET and syncs subscription/org status.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!BILLING_ENABLED) {
    return NextResponse.json({ error: "Billing is not enabled." }, { status: 404 });
  }
  try {
    const signature = req.headers.get("stripe-signature")?.trim() || "";
    const rawBody = await req.text();
    if (!verifyBillingSignature(signature, rawBody)) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }
    const event = JSON.parse(rawBody);
    await handleBillingEvent(event);
    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Webhook failed." }, { status: 400 });
  }
}
