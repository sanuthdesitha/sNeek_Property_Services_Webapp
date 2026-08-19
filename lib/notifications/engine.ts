import { NotificationChannel, NotificationLogStatus, NotificationRecipientRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { audienceForRole, isChannelAllowed } from "@/lib/notifications/audience-controls";
import { FINANCE_EVENTS } from "./events";
import type { EmailAutoKind } from "@/lib/notifications/email-kinds";

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
      const result = await sendViaChannel(eventKey, channel, substituted, options);

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
  eventKey: string,
  channel: NotificationChannel,
  content: { subject?: string; html?: string; text?: string; sms?: string; pushTitle?: string; pushBody?: string },
  options: SendNotificationOptions
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (channel) {
      case NotificationChannel.EMAIL: {
        if (!content.html || !options.to) return { ok: false, error: "Missing HTML or recipient email" };

        // Delegated to the shared chokepoint rather than this engine's own
        // Resend transport.
        //
        // It used to POST to Resend directly and re-implement only two of the
        // gates (master switch, audience channel). That silently bypassed the
        // suppression list, the per-audience x kind matrix, `User.allEmailOff`
        // and every per-kind `UserEmailPreference` — so all 35 finance events
        // (invoices, payroll, payouts, Xero) ignored what a person had actually
        // asked for, and turning them off in the admin UI appeared to do
        // nothing. Every gate now applies in one place.
        //
        // Each finance event now maps onto an EmailAutoKind
        // (FINANCE_EVENT_EMAIL_KIND below), so the per-kind switches in the
        // admin UI and each user's own preferences genuinely target them —
        // previously they carried no kind and only allEmailOff/suppression
        // applied.
        const { sendEmailDetailed } = await import("@/lib/notifications/email");
        const result = await sendEmailDetailed({
          to: options.to,
          subject: content.subject || "sNeek Ops Notification",
          html: content.html,
          kind: FINANCE_EVENT_EMAIL_KIND[eventKey],
        });

        if (result.skipped) return { ok: false, error: result.error ?? "skipped" };
        if (!result.ok) return { ok: false, error: result.error ?? "send failed" };
        return { ok: true };
      }

      case NotificationChannel.PUSH: {
        if (!content.pushTitle) return { ok: false, error: "Missing push title" };
        console.log(`[push] ${content.pushTitle}: ${content.pushBody}`);
        return { ok: true };
      }

      case NotificationChannel.SMS: {
        if (!content.sms || !options.to) return { ok: false, error: "Missing SMS body or recipient" };
        // Audience-level gating: own Twilio transport, so gate here. Resolve the
        // recipient's audience by phone → user role (no account → PUBLIC).
        const smsSettings = await getAppSettings();
        const smsUser = await db.user.findFirst({
          where: { phone: options.to },
          select: { role: true },
        });
        if (!isChannelAllowed(smsSettings.notificationAudienceControls, audienceForRole(smsUser?.role ?? null), "sms")) {
          return { ok: false, error: "audience_disabled" };
        }
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

/**
 * EmailAutoKind for each finance event, so per-kind switches reach them.
 *
 * Five kinds carry most of the taxonomy: payment_receipt (client-facing
 * money-in), payment_reminder (dunning), payout_notice (a cleaner's own
 * money), payroll_update (run lifecycle), integration_sync (Xero plumbing).
 * Failures route to admin_alert — a failure is an ops problem, not a
 * preference topic.
 */
export const FINANCE_EVENT_EMAIL_KIND: Record<string, EmailAutoKind> = {
  invoice_generated: "auto_invoice",
  invoice_approved: "admin_alert",
  invoice_sent_to_client: "admin_alert",
  invoice_paid_by_client: "admin_alert",
  invoice_payment_received: "payment_receipt",
  invoice_overdue: "payment_reminder",
  invoice_voided: "admin_alert",
  invoice_xero_exported: "integration_sync",
  payroll_run_created: "payroll_update",
  payroll_run_confirmed: "payroll_update",
  payroll_processing: "payroll_update",
  payroll_completed: "payroll_update",
  payroll_failed: "admin_alert",
  payout_sent: "payout_notice",
  payout_failed: "payout_notice",
  payout_aba_generated: "payroll_update",
  pay_adjustment_requested: "pay_adjustment",
  pay_adjustment_approved: "pay_adjustment",
  pay_adjustment_rejected: "pay_adjustment",
  pay_adjustment_sent_to_client: "pay_adjustment",
  pay_adjustment_client_approved: "pay_adjustment",
  pay_adjustment_client_declined: "pay_adjustment",
  pay_adjustment_paid: "pay_adjustment",
  client_payment_link_created: "payment_reminder",
  client_payment_initiated: "admin_alert",
  client_payment_succeeded: "payment_receipt",
  client_payment_failed: "payment_reminder",
  client_payment_refunded: "payment_receipt",
  xero_connected: "integration_sync",
  xero_disconnected: "admin_alert",
  xero_contact_synced: "integration_sync",
  xero_invoice_pushed: "integration_sync",
  xero_bill_created: "integration_sync",
  xero_sync_error: "admin_alert",
};
