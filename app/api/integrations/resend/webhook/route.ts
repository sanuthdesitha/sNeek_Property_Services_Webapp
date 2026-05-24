import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/lib/db";
import { suppress } from "@/lib/email/suppression";
import { logger } from "@/lib/logger";

interface ResendEvent {
  type:
    | "email.sent"
    | "email.delivered"
    | "email.delivery_delayed"
    | "email.bounced"
    | "email.complained"
    | "email.opened"
    | "email.clicked";
  created_at: string;
  data: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    bounce?: { type?: "hard" | "soft"; subType?: string };
    [key: string]: any;
  };
}

/**
 * Map Resend event type → NotificationLogStatus enum value.
 * Schema only supports SENT | FAILED | SKIPPED, so we collapse signals:
 *  - delivered / sent / opened / clicked → SENT
 *  - bounced / complained → FAILED
 *  - delivery_delayed → SKIPPED (interpreted as transient hold)
 */
function statusForEvent(type: ResendEvent["type"]): "SENT" | "FAILED" | "SKIPPED" {
  switch (type) {
    case "email.bounced":
    case "email.complained":
      return "FAILED";
    case "email.delivery_delayed":
      return "SKIPPED";
    default:
      return "SENT";
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const bodyText = await req.text();

  // Collect required svix headers
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing signature headers" },
      { status: 400 }
    );
  }

  let event: ResendEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(bodyText, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendEvent;
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const recipients = event.data.to ?? [];

  for (const to of recipients) {
    // Log every event to NotificationLog. The schema's NotificationLog model
    // is intentionally narrow: { eventKey, recipientEmail, recipientRole,
    // channel, status, subject, error, sentAt }. We map Resend-specific
    // detail into the available fields and skip logging silently if the
    // shape mismatches.
    try {
      await db.notificationLog.create({
        data: {
          eventKey: event.type,
          recipientEmail: to,
          recipientRole: "UNKNOWN",
          channel: "EMAIL",
          status: statusForEvent(event.type),
          subject: event.data.subject ?? null,
          error:
            event.type === "email.bounced"
              ? `bounce:${event.data.bounce?.type ?? "unknown"}`
              : event.type === "email.complained"
                ? "complaint"
                : null,
          sentAt: new Date(),
        },
      });
    } catch (err) {
      // Don't fail the webhook on logging errors
      logger.warn(
        { err, eventType: event.type, recipient: to },
        "Failed to write NotificationLog entry for Resend event"
      );
    }

    // Suppression actions
    if (event.type === "email.bounced") {
      const bounceType = event.data.bounce?.type;
      if (bounceType === "hard") {
        await suppress(to, "HARD_BOUNCE");
      }
      // Soft bounces: TODO(Plan F follow-up) — count in a rolling 7-day
      // window and escalate to SOFT_BOUNCE after 3 strikes.
    } else if (event.type === "email.complained") {
      await suppress(to, "COMPLAINT");
    }
  }

  return NextResponse.json({ ok: true, processed: recipients.length });
}
