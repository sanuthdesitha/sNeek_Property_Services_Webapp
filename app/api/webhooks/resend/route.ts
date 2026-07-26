/**
 * Resend webhook receiver.
 *
 * SIGNATURE VERIFICATION — two accepted schemes, checked in this order:
 *
 *  1. Svix (what Resend actually sends). `svix` is already a dependency
 *     (package.json) and is used by app/api/integrations/resend/webhook, so we
 *     use the library rather than reimplementing the HMAC. Secret:
 *     RESEND_WEBHOOK_SIGNING_SECRET (the `whsec_…` value from the Resend
 *     dashboard). Triggered when the svix-id / svix-timestamp / svix-signature
 *     headers are present.
 *  2. Legacy shared-secret HMAC (`resend-signature` header, hex SHA-256 of the
 *     raw body keyed on RESEND_WEBHOOK_SECRET). This endpoint already shipped
 *     with that scheme and an existing deployment may still be configured
 *     against it, so it is kept as a fallback rather than silently breaking
 *     notification delivery tracking.
 *
 * If neither secret is configured the request is rejected — an unauthenticated
 * webhook must never be allowed to write suppression entries.
 *
 * INGEST — two independent sinks:
 *  - Notification.deliveryStatus (pre-existing behaviour, keyed on externalId).
 *  - EmailCampaignEvent, when the provider message id matches a CampaignSend
 *    row (CampaignSend.externalId). Append-only: retries may duplicate a row,
 *    which is harmless because lib/marketing/campaign-analytics.ts counts
 *    DISTINCT recipients per event type.
 *
 * Bounces and complaints are additionally pushed into lib/email/suppression so
 * the address is never included in another marketing send.
 */
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { suppress } from "@/lib/email/suppression";
import type { CampaignEventType } from "@/lib/marketing/campaign-analytics";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyLegacySignature(signatureHeader: string, body: string, secret: string) {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return safeEqual(expected, signatureHeader);
}

/** Resend event type → our EmailCampaignEvent.type. Unknown types are ignored. */
function campaignEventType(type: string | undefined): CampaignEventType | null {
  switch (type) {
    case "email.sent":
      return "SENT";
    case "email.delivered":
      return "DELIVERED";
    case "email.opened":
      return "OPENED";
    case "email.clicked":
      return "CLICKED";
    case "email.bounced":
      return "BOUNCED";
    case "email.complained":
      return "COMPLAINED";
    case "email.delivery_delayed":
      return "DELAYED";
    default:
      return null;
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendPayload = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    bounce?: { type?: string; subType?: string };
    click?: { link?: string; ipAddress?: string; userAgent?: string };
    [key: string]: unknown;
  };
};

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");
    const svixSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET?.trim() || "";
    const legacySecret = process.env.RESEND_WEBHOOK_SECRET?.trim() || "";

    let payload: ResendPayload | null = null;

    if (svixId && svixTimestamp && svixSignature) {
      if (!svixSecret) {
        return NextResponse.json({ error: "RESEND_WEBHOOK_SIGNING_SECRET is not configured." }, { status: 500 });
      }
      try {
        payload = new Webhook(svixSecret).verify(rawBody, {
          "svix-id": svixId,
          "svix-timestamp": svixTimestamp,
          "svix-signature": svixSignature,
        }) as ResendPayload;
      } catch {
        return NextResponse.json({ error: "Invalid Resend signature." }, { status: 401 });
      }
    } else {
      if (!legacySecret) {
        return NextResponse.json({ error: "Resend webhook secret is not configured." }, { status: 400 });
      }
      const signature = req.headers.get("resend-signature")?.trim() || "";
      if (!signature || !verifyLegacySignature(signature, rawBody, legacySecret)) {
        return NextResponse.json({ error: "Invalid Resend signature." }, { status: 401 });
      }
      payload = JSON.parse(rawBody) as ResendPayload;
    }

    if (!payload) return NextResponse.json({ received: true, skipped: true });

    const emailId = String(payload.data?.email_id ?? "").trim();
    const eventType = campaignEventType(payload.type);

    // ── Sink 1: notification delivery tracking (pre-existing behaviour) ──
    if (emailId) {
      const deliveryStatus =
        payload.type === "email.delivered"
          ? "DELIVERED"
          : payload.type === "email.bounced"
            ? "BOUNCED"
            : payload.type === "email.opened"
              ? "OPENED"
              : null;

      if (deliveryStatus) {
        await db.notification.updateMany({
          where: { externalId: emailId },
          data: {
            deliveryStatus,
            status: deliveryStatus === "BOUNCED" ? NotificationStatus.FAILED : NotificationStatus.SENT,
            errorMsg: deliveryStatus === "BOUNCED" ? "Email bounced." : undefined,
          },
        });
      }
    }

    // ── Sink 2: campaign analytics ──
    let campaignIngested = 0;
    if (emailId && eventType) {
      const sends = (await (db as any).campaignSend.findMany({
        where: { externalId: emailId },
        select: { campaignId: true, email: true },
      })) as Array<{ campaignId: string; email: string }>;

      for (const send of sends) {
        await (db as any).emailCampaignEvent.create({
          data: {
            campaignId: send.campaignId,
            recipient: send.email.toLowerCase(),
            type: eventType,
            meta: {
              emailId,
              resendType: payload.type ?? null,
              occurredAt: payload.created_at ?? null,
              bounce: payload.data?.bounce ?? null,
              link: payload.data?.click?.link ?? null,
            } as any,
          },
        });
        campaignIngested += 1;
      }
    }

    // ── Suppression feedback: bounces + complaints never get emailed again ──
    if (eventType === "BOUNCED" || eventType === "COMPLAINED") {
      const recipients = Array.isArray(payload.data?.to) ? payload.data!.to! : [];
      const reason =
        eventType === "COMPLAINED"
          ? "COMPLAINT"
          : String(payload.data?.bounce?.type ?? "").toLowerCase() === "soft"
            ? "SOFT_BOUNCE"
            : "HARD_BOUNCE";
      for (const address of recipients) {
        const email = String(address ?? "").trim();
        if (!email) continue;
        try {
          await suppress(email, reason as any);
        } catch (err) {
          logger.error({ err, email }, "[resend-webhook] suppression write failed");
        }
      }
    }

    return NextResponse.json({ received: true, campaignEvents: campaignIngested });
  } catch (error: any) {
    logger.error({ err: error }, "[resend-webhook] failed");
    return NextResponse.json({ error: error?.message ?? "Webhook failed." }, { status: 400 });
  }
}
