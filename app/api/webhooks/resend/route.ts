import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyWebhookSignature(signatureHeader: string, body: string, secret: string) {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return safeEqual(expected, signatureHeader);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() || "";
    if (!secret) {
      return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not configured." }, { status: 400 });
    }

    const signature = req.headers.get("resend-signature")?.trim() || "";
    const rawBody = await req.text();
    if (!signature || !verifyWebhookSignature(signature, rawBody, secret)) {
      return NextResponse.json({ error: "Invalid Resend signature." }, { status: 400 });
    }

    const payload = JSON.parse(rawBody) as {
      type?: string;
      data?: { email_id?: string; created_at?: string };
    };

    const emailId = String(payload?.data?.email_id ?? "").trim();
    if (!emailId) {
      return NextResponse.json({ received: true, skipped: true });
    }

    const deliveryStatus =
      payload.type === "email.delivered"
        ? "DELIVERED"
        : payload.type === "email.bounced"
          ? "BOUNCED"
          : payload.type === "email.opened"
            ? "OPENED"
            : null;

    if (!deliveryStatus) {
      return NextResponse.json({ received: true, skipped: true });
    }

    await db.notification.updateMany({
      where: { externalId: emailId },
      data: {
        deliveryStatus,
        status: deliveryStatus === "BOUNCED" ? NotificationStatus.FAILED : NotificationStatus.SENT,
        errorMsg: deliveryStatus === "BOUNCED" ? "Email bounced." : undefined,
      },
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Webhook failed." }, { status: 400 });
  }
}
