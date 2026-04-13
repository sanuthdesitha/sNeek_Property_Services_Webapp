import { NotificationChannel, NotificationLogStatus, NotificationRecipientRole } from "@prisma/client";
import { db } from "@/lib/db";
import { FINANCE_EVENTS } from "./events";

type NotificationContext = Record<string, string | number | null | undefined>;

const CREDENTIAL_KEY = "integrationCredentials";

async function getIntegrationCredentials(): Promise<Record<string, string | boolean>> {
  const row = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
  return (row?.value as Record<string, string | boolean> | null) ?? {};
}

interface SendNotificationOptions {
  to?: string;
  channels?: NotificationChannel[];
  recipientRole?: NotificationRecipientRole;
}

/**
 * Core notification dispatcher.
 * Resolves template, checks preferences, substitutes variables, sends via channel, logs result.
 */
export async function sendNotification(
  eventKey: string,
  context: NotificationContext,
  options: SendNotificationOptions = {}
): Promise<void> {
  try {
    const eventDef = FINANCE_EVENTS.find((e) => e.key === eventKey);
    if (!eventDef) {
      console.warn(`[notifications] Unknown event key: ${eventKey}`);
      return;
    }

    const channels = options.channels ?? Array.from(eventDef.defaultChannels) as NotificationChannel[];
    const recipientRole = options.recipientRole ?? (eventDef.defaultRecipients[0] as NotificationRecipientRole);

    // Check preferences for each channel
    for (const channel of channels) {
      const pref = await db.notificationPreference.findUnique({
        where: { eventKey_recipientRole_channel: { eventKey, recipientRole, channel } },
      });

      if (pref && !pref.enabled) {
        await logNotification(eventKey, context, channel, recipientRole, "SKIPPED", "Notification disabled by preference");
        continue;
      }

      // Load template
      const template = await db.notificationTemplate.findUnique({ where: { eventKey } });
      if (!template) {
        await logNotification(eventKey, context, channel, recipientRole, "FAILED", "No template found");
        continue;
      }

      // Substitute variables
      const substituted = substituteTemplate(template, context);

      // Send via channel
      const result = await sendViaChannel(channel, substituted, options);

      if (result.ok) {
        await logNotification(eventKey, context, channel, recipientRole, "SENT", undefined, substituted.subject);
      } else {
        await logNotification(eventKey, context, channel, recipientRole, "FAILED", result.error, substituted.subject);
      }
    }
  } catch (err) {
    console.error(`[notifications] Error sending ${eventKey}:`, err);
  }
}

function substituteTemplate(
  template: { emailSubject?: string | null; emailBodyHtml?: string | null; emailBodyText?: string | null; smsBody?: string | null; pushTitle?: string | null; pushBody?: string | null },
  context: NotificationContext
): { subject?: string; html?: string; text?: string; sms?: string; pushTitle?: string; pushBody?: string } {
  const sub = (str: string | null | undefined) => {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const val = context[key];
      return val != null ? String(val) : "";
    });
  };

  return {
    subject: sub(template.emailSubject) ?? undefined,
    html: sub(template.emailBodyHtml) ?? undefined,
    text: sub(template.emailBodyText) ?? undefined,
    sms: sub(template.smsBody) ?? undefined,
    pushTitle: sub(template.pushTitle) ?? undefined,
    pushBody: sub(template.pushBody) ?? undefined,
  };
}

async function sendViaChannel(
  channel: NotificationChannel,
  content: { subject?: string; html?: string; text?: string; sms?: string; pushTitle?: string; pushBody?: string },
  options: SendNotificationOptions
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (channel) {
      case NotificationChannel.EMAIL: {
        if (!content.html || !options.to) return { ok: false, error: "Missing HTML or recipient email" };
        const creds = await getIntegrationCredentials();
        const resendApiKey = (creds.resendApiKey as string) || process.env.RESEND_API_KEY;
        if (!resendApiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

        const emailFrom = (creds.emailFrom as string) || "sNeek Ops <onboarding@resend.dev>";

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: emailFrom,
            to: [options.to],
            subject: content.subject || "sNeek Ops Notification",
            html: content.html,
            ...(content.text ? { text: content.text } : {}),
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { ok: false, error: `Resend API error: ${body}` };
        }
        return { ok: true };
      }

      case NotificationChannel.PUSH: {
        if (!content.pushTitle) return { ok: false, error: "Missing push title" };
        console.log(`[push] ${content.pushTitle}: ${content.pushBody}`);
        return { ok: true };
      }

      case NotificationChannel.SMS: {
        if (!content.sms || !options.to) return { ok: false, error: "Missing SMS body or recipient" };
        const creds = await getIntegrationCredentials();
        const twilioSid = (creds.twilioAccountSid as string) || process.env.TWILIO_ACCOUNT_SID;
        if (!twilioSid) return { ok: false, error: "TWILIO_ACCOUNT_SID not configured" };

        const twilioAuth = (creds.twilioAuthToken as string) || process.env.TWILIO_AUTH_TOKEN;
        const twilioFrom = (creds.twilioPhoneNumber as string) || process.env.TWILIO_PHONE_NUMBER;
        if (!twilioAuth || !twilioFrom) return { ok: false, error: "Twilio credentials not configured" };

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioAuth}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            From: twilioFrom,
            To: options.to,
            Body: content.sms,
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { ok: false, error: `Twilio API error: ${body}` };
        }
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown channel: ${channel}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function logNotification(
  eventKey: string,
  context: NotificationContext,
  channel: NotificationChannel,
  recipientRole: NotificationRecipientRole,
  status: NotificationLogStatus,
  error?: string,
  subject?: string
) {
  await db.notificationLog.create({
    data: {
      eventKey,
      recipientEmail: typeof context.to === "string" ? context.to : undefined,
      recipientRole,
      channel,
      status,
      subject,
      error,
      sentAt: status === "SENT" ? new Date() : undefined,
    },
  });
}
