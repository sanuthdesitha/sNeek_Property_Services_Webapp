import "server-only";
import { plainMessageEmail } from "@/lib/email-design/build-email";
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
import { authorizeEntityRecipient, isSupportedEntityScope } from "./recipient-scopes";
import type { SafeguardMeta } from "./safeguards/gate";

/** What the sending safeguards need from an envelope (type by event key, subject entity, recipient). */
function safeguardMeta(envelope: NotificationEnvelope): SafeguardMeta {
  return { eventKey: envelope.eventKey, entityKey: `${envelope.entity.type}:${envelope.entity.id}`, recipientUserId: envelope.recipient.userId };
}

export function enabledIntentProviderTransports() {
  return (process.env.SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS ?? "").split(",").map(value => value.trim()).filter(value => ["EMAIL", "SMS", "WEB_PUSH"].includes(value));
}
const emailKinds: Record<NonNullable<NotificationEnvelope["category"]>, EmailAutoKind> = {
  account: "admin_alert", jobs: "job_reminder", laundry: "admin_alert", cases: "case_alert", reports: "report_delivery",
  quotes: "admin_alert", shopping: "inventory_update", billing: "auto_invoice", approvals: "admin_alert", ical: "ical_alert",
};

/** One recipient/device per intent; do not retry a fan-out that partly succeeded. */
export async function deliverProviderIntent(envelope: NotificationEnvelope): Promise<DeliveryAttemptOutcome> {
  let dispatchStarted = false;
  try {
    if (!enabledIntentProviderTransports().includes(envelope.transport)) return { kind: "SKIPPED", errorCode: "transport_not_enabled" };
    const entityScope = envelope.recipient.scope.kind === "ENTITY";
    if (entityScope ? !isSupportedEntityScope((envelope.recipient.scope as { type: string }).type) : !["ADMIN", "OPS_MANAGER"].includes(envelope.recipient.role)) return { kind: "SKIPPED", errorCode: "unsupported_recipient_scope" };
    if (!envelope.category) return { kind: "SKIPPED", errorCode: "category_required" };
    const user = await db.user.findUnique({ where: { id: envelope.recipient.userId }, select: { id: true, role: true, isActive: true, email: true, phone: true } });
    if (!user?.isActive || user.role !== envelope.recipient.role) return { kind: "SKIPPED", errorCode: "recipient_unavailable" };
    if (entityScope) {
      // Revalidated at send time: a removed assignment or changed scope never receives it.
      const authorization = await authorizeEntityRecipient(db, envelope.recipient);
      if (!authorization.ok) return { kind: "SKIPPED", errorCode: authorization.errorCode };
    }
    const channel = envelope.transport === "WEB_PUSH" ? "PUSH" : envelope.transport === "EMAIL" ? "EMAIL" : "SMS";
    if (envelope.templateRecipientRole) {
      const preference = await db.notificationPreference.findUnique({ where: { eventKey_recipientRole_channel: { eventKey: envelope.eventKey, recipientRole: envelope.templateRecipientRole, channel } } });
      if (preference && !preference.enabled) return { kind: "SKIPPED", errorCode: "event_preference" };
    }
    const audience = audienceForRole(user.role);
    // An office-directed type that ignores preferences skips the category
    // preference and, for push, the audience switch — as its direct path does.
    // Email and SMS keep their provider chokepoints' own audience gates.
    const officeDirected = envelope.recipientPreferences === "IGNORE";
    if (!officeDirected) {
      if (!await canDeliverNotification({ userId: user.id, role: user.role, category: envelope.category, channel })) return { kind: "SKIPPED", errorCode: "recipient_preference" };
      const settings = await getAppSettings();
      if (!isChannelAllowed(settings.notificationAudienceControls, audience, envelope.transport === "WEB_PUSH" ? "push" : envelope.transport === "EMAIL" ? "email" : "sms")) return { kind: "SKIPPED", errorCode: "audience_disabled" };
    }
    if (envelope.transport === "EMAIL") {
      if (!user.email) return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "missing_email" };
      dispatchStarted = true;
      const result = await sendEmailDetailed({ to: user.email, subject: envelope.subject ?? "Notification", html: envelope.emailHtml ?? plainMessageEmail({ subject: envelope.subject ?? "Notification", text: envelope.body }).html, kind: envelope.emailKind ?? emailKinds[envelope.category], audience, safeguard: safeguardMeta(envelope) });
      if (result.suppressed) return { kind: "SKIPPED", errorCode: `safeguard_${result.suppressed.reason.toLowerCase()}` };
      if (result.skipped) return { kind: "SKIPPED", errorCode: "email_preference_or_suppression" };
      if (result.ok && result.externalId) return { kind: "ACCEPTED", providerReference: result.externalId };
      if (result.acceptance === "NOT_ACCEPTED") return { kind: "NOT_ACCEPTED", retryable: Boolean(result.retryable), errorCode: "email_rejected" };
      return { kind: "UNCERTAIN", errorCode: "email_acceptance_unknown" };
    }
    if (envelope.transport === "SMS") {
      if (!user.phone) return { kind: "NOT_ACCEPTED", retryable: false, errorCode: "missing_phone" };
      dispatchStarted = true;
      const result = await sendSmsDetailed(user.phone, envelope.body, audience, safeguardMeta(envelope));
      if (result.status === "suppressed") return { kind: "SKIPPED", errorCode: `safeguard_${(result.suppressed?.reason ?? "SAFEGUARD_UNAVAILABLE").toLowerCase()}` };
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
      url: envelope.url ?? resolveNotificationHrefForRole({ jobId: envelope.jobId, subject: envelope.subject, body: envelope.body }, user.role), tag: `event-${envelope.eventId}` },
      { userId: user.id, meta: safeguardMeta(envelope), deviceKey: subscription.id });
    if (result.suppressed) return { kind: "SKIPPED", errorCode: "safeguard_not_sent" };
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
