import { NotificationChannel, NotificationLogStatus, NotificationRecipientRole } from "@prisma/client";
import { db } from "@/lib/db";
import { FINANCE_EVENTS } from "./events";
import type { EmailAutoKind } from "@/lib/notifications/email-kinds";

type NotificationContext = Record<string, string | number | null | undefined>;

interface SendNotificationOptions {
  to?: string;
  channels?: NotificationChannel[];
  recipientRole?: NotificationRecipientRole;
  durable?: Omit<import("./queue-delivery").DurableDeliveryContext, "eventKey" | "transports" | "templateRecipientRole"> & {
    recipient: import("./delivery").Recipient;
  };
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
  if (options.durable) {
    // Failures must abort the caller's transaction, rather than being swallowed
    // by the legacy best-effort dispatcher below.
    const { queueDelivery } = await import("./queue-delivery");
    const eventDef = FINANCE_EVENTS.find(event => event.key === eventKey);
    if (!eventDef) throw new Error("Unknown notification event.");
    const recipientRole = options.recipientRole ?? eventDef.defaultRecipients[0];
    if (recipientRole !== "ADMIN") throw new Error("This template recipient scope has no durable authorization adapter.");
    const template = await options.durable.tx.notificationTemplate.findUnique({ where: { eventKey } });
    if (!template) throw new Error("Notification template unavailable.");
    const substituted = substituteTemplate(template, context);
    const content = { ...substituted, html: await financeEmailHtml(eventKey, context, substituted.html, substituted.subject ?? "sNeek Ops Notification") };
    const channels = options.channels ?? Array.from(eventDef.defaultChannels) as NotificationChannel[];
    if ((channels.includes("EMAIL") && !content.html) || (channels.includes("SMS") && !content.sms) || (channels.includes("PUSH") && (!content.pushTitle || !content.pushBody))) throw new Error("Notification template content incomplete.");
    await queueDelivery({
      recipients: [options.durable.recipient], category: "billing",
      web: { subject: content.pushTitle ?? content.subject ?? "Notification", body: content.pushBody ?? content.text ?? content.subject ?? "Notification" },
      email: channels.includes("EMAIL") ? { subject: content.subject ?? "sNeek Ops Notification", html: content.html!, logBody: content.text } : null,
      sms: channels.includes("SMS") ? content.sms : null,
      kind: FINANCE_EVENT_EMAIL_KIND[eventKey],
    }, { ...options.durable, eventKey, templateRecipientRole: recipientRole,
      transports: [...(channels.includes("EMAIL") ? ["EMAIL" as const] : []), ...(channels.includes("SMS") ? ["SMS" as const] : []), ...(channels.includes("PUSH") ? ["INBOX" as const, "WEB_PUSH" as const] : [])],
    });
    return;
  }
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
      const substitutedRaw = substituteTemplate(template, context);
      const substituted = channel === NotificationChannel.EMAIL
        ? { ...substitutedRaw, html: await financeEmailHtml(eventKey, context, substitutedRaw.html, substitutedRaw.subject ?? "sNeek Ops Notification") }
        : substitutedRaw;

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

/**
 * The email of a finance event is a block design (finance.<event>). An HTML
 * body saved before blocks goes out as it is (marked custom) until a block
 * version is published; with neither, nothing is emailed, as before.
 */
async function financeEmailHtml(eventKey: string, context: NotificationContext, savedHtml: string | undefined, subject: string): Promise<string | undefined> {
  const [{ findEmailDesign }, { getPublishedDocument }, { embedSpec }, { financeDesignKey }] = await Promise.all([
    import("@/lib/email-design/all-designs"),
    import("@/lib/email-design/store"),
    import("@/lib/email-design/spec"),
    import("@/lib/email-design/catalog/finance"),
  ]);
  const definition = findEmailDesign(financeDesignKey(eventKey));
  if (!definition) return savedHtml;
  const published = await getPublishedDocument(definition);
  if (!savedHtml && !published) return undefined;
  const values = Object.fromEntries(Object.entries(context).map(([name, value]) => [name, value == null ? "" : String(value)]));
  return embedSpec(savedHtml ?? "", { v: 1, kind: "design", key: definition.key, values, subject, body: savedHtml ?? "", ...(savedHtml ? { custom: true } : {}) });
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
        // This template dispatcher has no user/device recipient contract yet.
        // Never log successful delivery when no transport was called.
        return { ok: false, error: "Push delivery is not configured for the template dispatcher" };
      }

      case NotificationChannel.SMS: {
        if (!content.sms || !options.to) return { ok: false, error: "Missing SMS body or recipient" };
        // Through the one SMS chokepoint (provider choice, audience switches and
        // the sending safeguards). This used to call Twilio's API directly,
        // which no cap, pause or emergency stop could see.
        const { sendSmsDetailed } = await import("@/lib/notifications/sms");
        const result = await sendSmsDetailed(options.to, content.sms, undefined, { typeKey: "money.finance_events" });
        if (result.ok) return { ok: true };
        return { ok: false, error: result.error ?? result.status };
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
