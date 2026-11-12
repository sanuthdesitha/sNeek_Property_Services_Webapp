import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { applyStripeCheckoutPayment, readCheckoutSession } from "@/lib/finance/stripe-checkout-payment";

function getWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyStripeSignature(signatureHeader: string, body: string, secret: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signature = parts.find((part) => part.startsWith("v1="))?.slice(3);
  if (!timestamp || !signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return safeEqual(expected, signature);
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const secret = getWebhookSecret();
    if (!secret) {
      return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 400 });
    }

    const signature = req.headers.get("stripe-signature")?.trim() || "";
    const rawBody = await req.text();
    if (!verifyStripeSignature(signature, rawBody, secret)) {
      return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
    }

    const payload = JSON.parse(rawBody) as {
      type?: string;
      data?: { object?: Record<string, any> };
    };
    if (payload?.type === "checkout.session.completed") {
      await applyCheckoutSession(payload.data?.object ?? {});
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Webhook failed." }, { status: 400 });
  }
}

/**
 * A completed checkout settles what the client was charged, through the same
 * owing rule as every other payment (payments + approved/sent credits must
 * reach the total before the invoice is PAID). See
 * lib/finance/stripe-checkout-payment.ts.
 */
async function applyCheckoutSession(object: Record<string, unknown>) {
  const session = readCheckoutSession(object);
  if (!session) return;
  const result = await applyStripeCheckoutPayment(session);
  if (result.outcome === "unreadable" || result.outcome === "not-paid") {
    logger.error({ invoiceId: session.invoiceId, sessionId: session.sessionId, reason: result.reason }, "[stripe-webhook] checkout not applied; needs manual review");
    return;
  }
  if (result.outcome !== "recorded") return;
  // Settle the attempt row the checkout created. Best-effort and last: the
  // invoice is already updated, and failing the webhook here would have Stripe
  // retry a payment already applied.
  await db.clientPayment
    .updateMany({
      where: { invoiceId: session.invoiceId, status: "PENDING" },
      data: { status: "SUCCEEDED", paidAt: new Date() },
    })
    .catch((err) =>
      logger.error(
        { err, invoiceId: session.invoiceId },
        "[stripe-webhook] invoice payment recorded but the payment row could not be settled"
      )
    );
}
