import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";

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
      const object = payload.data?.object ?? {};
      const invoiceId = String(object?.metadata?.invoiceId ?? "").trim();
      if (invoiceId) {
        await db.clientInvoice.updateMany({
          where: {
            id: invoiceId,
            status: { in: [ClientInvoiceStatus.SENT, ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.DRAFT] },
          },
          data: {
            status: ClientInvoiceStatus.PAID,
            paidAt: new Date(),
            stripePaymentIntentId:
              typeof object.payment_intent === "string" ? object.payment_intent : null,
          },
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Webhook failed." }, { status: 400 });
  }
}
