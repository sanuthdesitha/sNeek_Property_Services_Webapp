import "server-only";
import { db } from "@/lib/db";
import { canDeliverNotification } from "./preferences";
import { audienceForRole, isChannelAllowed } from "./audience-controls";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "./email";
import { sendSmsDetailed } from "./sms";
import { sendWebPush } from "./web-push";
import { resolveNotificationHrefForRole } from "./feed";
import type { EmailAutoKind } from "./email-kinds";
import type { NotificationEnvelope, DeliveryAttemptOutcome } from "./intent-contract";

export function enabledIntentProviderTransports() {
  return (process.env.SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS ?? "").split(",").map(value => value.trim()).filter(value => ["EMAIL", "SMS", "WEB_PUSH"].includes(value));
}
const emailKinds: Record<NonNullable<NotificationEnvelope["category"]>, EmailAutoKind> = {
  account: "admin_alert", jobs: "job_reminder", laundry: "admin_alert", cases: "case_alert", reports: "report_delivery",
  quotes: "admin_alert", shopping: "inventory_update", billing: "auto_invoice", approvals: "admin_alert", ical: "ical_alert",
};
const htmlEscape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

/** One recipient/device per intent; do not retry a fan-out that partly succeeded. */
export async function deliverProviderIntent(envelope: NotificationEnvelope): Promise<DeliveryAttemptOutcome> {
  let dispatchStarted = false;
  try {
    if (!enabledIntentProviderTransports().includes(envelope.transport)) return { kind: "SKIPPED", errorCode: "transport_not_enabled" };
    if (envelope.recipient.scope.kind !== "ADMIN_OPERATIONS" || !["ADMIN", "OPS_MANAGER"].includes(envelope.recipient.role)) return { kind: "SKIPPED", errorCode: "unsupported_recipient_scope" };
    if (!envelope.category) return { kind: "SKIPPED", errorCode: "category_required" };
    const user = await db.user.findUnique({ where: { id: envelope.recipient.userId }, select: { id: true, role: true, isActive: true, email: true, phone: true } });
    if (!user?.isActive || user.role !== envelope.recipient.role) return { kind: "SKIPPED", errorCode: "recipient_unavailable" };
    const channel = envelope.transport === "WEB_PUSH" ? "PUSH" : envelope.transport === "EMAIL" ? "EMAIL" : "SMS";
    if (envelope.templateRecipientRole) {
      const preference = await db.notificationPreference.findUnique({ where: { eventKey_recipientRole_channel: { eventKey: envelope.eventKey, recipientRole: envelope.templateRecipientRole, channel } } });
      if (preference && !preference.enabled) return { kind: "SKIPPED", errorCode: "event_preference" };
    }
    if (!await canDeliverNotification({ userId: user.id, role: user.role, category: envelope.category, channel })) return { kind: "SKIPPED", errorCode: "recipient_preference" };
    const audience = audienceForRole(user.role);
    const settings = await getAppSettings();
    if (!isChannelAllowed(settings.notificationAudienceControls, audience, envelope.transport === "WEB_PUSH" ? "push" : envelope.transport === "EMAIL" ? "email" : "sms")) return { kind: "SKIPPED", errorCode: "audience_disabled" };
    if (envelope.transport === "EMAIL") {
      if (!user.email) return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "missing_email" };
      dispatchStarted = true;
      const result = await sendEmailDetailed({ to: user.email, subject: envelope.subject ?? "Notification", html: envelope.emailHtml ?? `<p>${htmlEscape(envelope.body).replace(/\n/g, "<br>")}</p>`, kind: envelope.emailKind ?? emailKinds[envelope.category], audience });
      if (result.skipped) return { kind: "SKIPPED", errorCode: "email_preference_or_suppression" };
      if (result.ok && result.externalId) return { kind: "ACCEPTED", providerReference: result.externalId };
      if (result.acceptance === "NOT_ACCEPTED") return { kind: "NOT_ACCEPTED", retryable: Boolean(result.retryable), errorCode: "email_rejected" };
      return { kind: "UNCERTAIN", errorCode: "email_acceptance_unknown" };
    }
    if (envelope.transport === "SMS") {
      if (!user.phone) return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "missing_phone" };
      dispatchStarted = true;
      const result = await sendSmsDetailed(user.phone, envelope.body, audience);
      if (result.status === "disabled") return { kind: "SKIPPED", errorCode: "sms_disabled" };
      if (result.status === "not_configured") return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "sms_not_configured" };
      if (result.ok) return { kind: "ACCEPTED" };
      return { kind: "UNCERTAIN", errorCode: "sms_acceptance_unknown" };
    }
    if (!envelope.subscriptionId) return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "subscription_required" };
    const subscription = await db.pushSubscription.findFirst({ where: { id: envelope.subscriptionId, userId: user.id } });
    if (!subscription) return { kind: "SKIPPED", errorCode: "subscription_unavailable" };
    dispatchStarted = true;
    const result = await sendWebPush(subscription, { title: envelope.subject ?? "Notification", body: envelope.body,
      url: envelope.url ?? resolveNotificationHrefForRole({ jobId: envelope.jobId, subject: envelope.subject, body: envelope.body }, user.role), tag: `event-${envelope.eventId}` });
    if (result.ok) return { kind: "ACCEPTED" };
    if (result.gone) {
      await db.pushSubscription.deleteMany({ where: { id: subscription.id, userId: user.id, endpoint: subscription.endpoint } });
      return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "subscription_revoked" };
    }
    if (result.statusCode === 429) return { kind: "NOT_ACCEPTED", retryable: true, errorCode: "push_rate_limited" };
    if (result.statusCode && [400, 401, 403, 404, 410, 413].includes(result.statusCode)) return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "push_rejected" };
    return { kind: "UNCERTAIN", errorCode: "push_acceptance_unknown" };
  } catch {
    return dispatchStarted ? { kind: "UNCERTAIN", errorCode: "provider_outcome_unknown" }
      : { kind: "NOT_ACCEPTED", retryable: true, errorCode: "pre_dispatch_unavailable" };
  }
}
