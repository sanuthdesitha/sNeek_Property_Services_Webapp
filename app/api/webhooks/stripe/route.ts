import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

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
        const paidAt = new Date();
        const paymentIntentId =
          typeof object.payment_intent === "string" ? object.payment_intent : null;

        // The invoice's own total, because this settles the whole balance. Read
        // first so paidAmount can be written — it was being left null, and
        // outstandingOf() derives from paidAmount, so a card-paid invoice still
        // read as owing its full value everywhere that figure appears. It said
        // PAID and behaved as unpaid.
        const invoice = await db.clientInvoice.findUnique({
          where: { id: invoiceId },
          select: { totalAmount: true },
        });

        await db.clientInvoice.updateMany({
          where: {
            id: invoiceId,
            status: { in: [ClientInvoiceStatus.SENT, ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.DRAFT] },
          },
          data: {
            status: ClientInvoiceStatus.PAID,
            paidAt,
            paidDate: paidAt,
            ...(invoice ? { paidAmount: invoice.totalAmount } : {}),
            paymentMethod: "STRIPE",
            ...(paymentIntentId ? { paymentReference: paymentIntentId } : {}),
            stripePaymentIntentId: paymentIntentId,
          },
        });

        // Settle the attempt row the checkout created. It was written PENDING
        // and then never touched by anything, so every card payment ever taken
        // left a permanently-pending record behind — a payments table that
        // disagreed with its own invoices, and a refund or dispute later with
        // nothing to reconcile against.
        //
        // Best-effort and last: the invoice is already marked paid, and failing
        // the webhook here would have Stripe retry a payment already applied.
        await db.clientPayment
          .updateMany({
            where: { invoiceId, status: "PENDING" },
            data: { status: "SUCCEEDED", paidAt },
          })
          .catch((err) =>
            logger.error(
              { err, invoiceId },
              "[stripe-webhook] invoice marked paid but the payment row could not be settled"
            )
          );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Webhook failed." }, { status: 400 });
  }
}
