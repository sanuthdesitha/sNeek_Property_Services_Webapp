import "server-only";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import type { NotificationCategory } from "@/lib/settings";
import { getAppSettings } from "@/lib/settings";
import { enqueueNotificationIntent } from "./intent-store";
import { deliverInboxIntentsNow } from "./inline-dispatch";
import { authorizeEntityRecipient, type RecipientScopeType } from "./recipient-scopes";
import { transportPath, type TransportPath } from "./transport-paths";
import { sendEmailDetailed } from "./email";
import { sendWebPushToUser } from "./web-push";
import { canDeliverNotification } from "./preferences";
import { audienceForRole, isChannelAllowed } from "./audience-controls";
import { dispatchNotificationOnce } from "./dispatch-once";
import type { EmailAutoKind } from "./email-kinds";
import type { NotificationTransport } from "./catalog-types";

/**
 * Office-initiated notifications on the durable pipeline, with an explicit,
 * audited recipient scope and explicitly chosen transports.
 *
 * - "PUSH" means what it meant for the legacy reminder: an inbox row, its
 *   phone-app push (mobile outbox marker) and a browser push.
 * - "INBOX" (Wave F) is the inbox row alone: no phone push, no browser push,
 *   so an inbox-only request never silently becomes a device push.
 * - The inbox row always goes through the pipeline and is delivered at once.
 * - Browser push and email go through the pipeline when their outbox transport
 *   is on (SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS); otherwise they keep the
 *   direct send, so nothing silently stops, and the outcome says which path.
 * - Every outcome is a truthful state: queued, inbox available, provider
 *   accepted, requested (browser push has no receipt), skipped or failed.
 */
export type OfficeSendTransport = "INBOX" | "PUSH" | "EMAIL";

export type OfficeRecipient = { id: string; role: Role; name: string | null; email: string | null };

export type OfficeDeliveryState = "queued" | "inbox_available" | "provider_accepted" | "requested" | "already_requested" | "uncertain" | "skipped" | "failed" | "switched_off";

export type RecipientOutcome = {
  userId: string;
  name: string;
  transport: Exclude<NotificationTransport, "SMS">;
  path: TransportPath;
  state: OfficeDeliveryState;
  errorCode?: string | null;
};

export type OfficeSendInput = {
  typeKey: string;
  eventKey: string;
  /** Stable per request (includes the caller's idempotency key). */
  eventId: string;
  entity: { type: string; id: string };
  /** The person who sent it; null for a scheduled send (the envelope allows it). */
  actorId: string | null;
  scopeType: RecipientScopeType;
  /** The scope entity for a recipient (job id, laundry task id, or the user id for STAFF_MEMBER). */
  scopeId: (recipient: OfficeRecipient) => string;
  category: NotificationCategory;
  severity: "INFO" | "ACTION" | "CRITICAL";
  jobId: string | null;
  subject: string;
  body: string;
  url?: string;
  email?: (recipient: OfficeRecipient) => { subject: string; html: string };
  emailKind?: EmailAutoKind;
  transports: OfficeSendTransport[];
  recipients: OfficeRecipient[];
  respectsPreferences: boolean;
  disabledTransports: NotificationTransport[];
};

const displayName = (recipient: OfficeRecipient) => recipient.name ?? recipient.email ?? "Recipient";

type Planned = { recipient: OfficeRecipient; inboxIntentId?: string; inboxOnly?: boolean; directWebPush: boolean; directEmail: boolean; outcomes: RecipientOutcome[] };

function baseEnvelope(input: OfficeSendInput, recipient: OfficeRecipient) {
  return {
    version: 1 as const, eventId: input.eventId, eventKey: input.eventKey, entity: input.entity, actorId: input.actorId,
    recipient: { userId: recipient.id, role: recipient.role, scope: { kind: "ENTITY" as const, type: input.scopeType, id: input.scopeId(recipient) } },
    severity: input.severity, category: input.category, jobId: input.jobId, subject: input.subject, body: input.body,
    ...(input.respectsPreferences ? {} : { recipientPreferences: "IGNORE" as const }),
  };
}

/** Enqueue everything on the pipeline in one transaction; plan the direct sends. */
async function planAndEnqueue(input: OfficeSendInput): Promise<Planned[]> {
  const off = new Set(input.disabledTransports);
  const webPushPath = transportPath("WEB_PUSH");
  const emailPath = transportPath("EMAIL");
  return db.$transaction(async (tx) => {
    const plans: Planned[] = [];
    for (const recipient of input.recipients) {
      const name = displayName(recipient);
      const plan: Planned = { recipient, directWebPush: false, directEmail: false, outcomes: [] };
      plans.push(plan);
      const authorization = await authorizeEntityRecipient(tx, baseEnvelope(input, recipient).recipient);
      if (!authorization.ok) {
        for (const transport of input.transports) plan.outcomes.push({ userId: recipient.id, name, transport: transport === "EMAIL" ? "EMAIL" : "INBOX", path: "pipeline", state: "skipped", errorCode: authorization.errorCode });
        continue;
      }
      const base = baseEnvelope(input, recipient);
      const wantsPush = input.transports.includes("PUSH");
      if (wantsPush || input.transports.includes("INBOX")) {
        if (off.has("INBOX")) {
          plan.outcomes.push({ userId: recipient.id, name, transport: "INBOX", path: "pipeline", state: "switched_off" });
        } else {
          const phonePush = wantsPush && !off.has("MOBILE_PUSH");
          const intent = await enqueueNotificationIntent(tx, { ...base, transport: "INBOX", ...(phonePush ? { mobilePushCategory: input.category } : {}) });
          plan.inboxIntentId = intent.id;
          plan.inboxOnly = !wantsPush;
          if (wantsPush && !phonePush) plan.outcomes.push({ userId: recipient.id, name, transport: "MOBILE_PUSH", path: "pipeline", state: "switched_off" });
        }
      }
      if (wantsPush) {
        if (off.has("WEB_PUSH")) {
          plan.outcomes.push({ userId: recipient.id, name, transport: "WEB_PUSH", path: webPushPath, state: "switched_off" });
        } else if (webPushPath === "pipeline") {
          const subscriptions = await tx.pushSubscription.findMany({ where: { userId: recipient.id }, select: { id: true } });
          for (const subscription of subscriptions) {
            await enqueueNotificationIntent(tx, { ...base, transport: "WEB_PUSH", subscriptionId: subscription.id, ...(input.url ? { url: input.url } : {}) });
          }
          plan.outcomes.push({ userId: recipient.id, name, transport: "WEB_PUSH", path: "pipeline", state: subscriptions.length ? "queued" : "skipped", errorCode: subscriptions.length ? null : "no_browser_subscription" });
        } else {
          plan.directWebPush = true;
        }
      }
      if (input.transports.includes("EMAIL")) {
        const content = input.email?.(recipient);
        if (off.has("EMAIL")) {
          plan.outcomes.push({ userId: recipient.id, name, transport: "EMAIL", path: emailPath, state: "switched_off" });
        } else if (!recipient.email || !content) {
          plan.outcomes.push({ userId: recipient.id, name, transport: "EMAIL", path: emailPath, state: "failed", errorCode: "missing_email" });
        } else if (emailPath === "pipeline") {
          await enqueueNotificationIntent(tx, { ...base, transport: "EMAIL", subject: content.subject, emailHtml: content.html, ...(input.emailKind ? { emailKind: input.emailKind } : {}) });
          plan.outcomes.push({ userId: recipient.id, name, transport: "EMAIL", path: "pipeline", state: "queued" });
        } else {
          plan.directEmail = true;
        }
      }
    }
    return plans;
  });
}

/** Mirrors deliverNotificationToRecipients' gates for a direct send of a type that respects preferences. */
async function directAllowed(input: OfficeSendInput, recipient: OfficeRecipient, channel: "web" | "email"): Promise<boolean> {
  if (!input.respectsPreferences) return true;
  const allowed = await canDeliverNotification({ userId: recipient.id, role: recipient.role, category: input.category, channel: channel === "web" ? "WEB" : "EMAIL" });
  const controls = (await getAppSettings()).notificationAudienceControls;
  return allowed && isChannelAllowed(controls, audienceForRole(recipient.role), channel === "web" ? "push" : "email");
}

async function sendDirectWebPush(input: OfficeSendInput, recipient: OfficeRecipient): Promise<RecipientOutcome> {
  const base = { userId: recipient.id, name: displayName(recipient), transport: "WEB_PUSH" as const, path: "direct" as const };
  if (!(await directAllowed(input, recipient, "web"))) return { ...base, state: "skipped", errorCode: "recipient_preference" };
  const claimed = await dispatchNotificationOnce({ event: `${input.eventId}:WEB_PUSH`, day: "office", recipientId: recipient.id, jobId: input.jobId ?? undefined }, async () => {
    // Best-effort, as before: the provider gives no receipt we can record here.
    await sendWebPushToUser(recipient.id, { title: input.subject, body: input.body, url: input.url ?? "/", tag: `${input.eventKey}-${input.entity.id}` });
  });
  return { ...base, state: claimed ? "requested" : "already_requested" };
}

async function sendDirectEmail(input: OfficeSendInput, recipient: OfficeRecipient): Promise<RecipientOutcome> {
  const base = { userId: recipient.id, name: displayName(recipient), transport: "EMAIL" as const, path: "direct" as const };
  const content = input.email?.(recipient);
  if (!recipient.email || !content) return { ...base, state: "failed", errorCode: "missing_email" };
  if (!(await directAllowed(input, recipient, "email"))) return { ...base, state: "skipped", errorCode: "recipient_preference" };
  let outcome: RecipientOutcome = { ...base, state: "already_requested" };
  await dispatchNotificationOnce({ event: `${input.eventId}:EMAIL`, day: "office", recipientId: recipient.id, jobId: input.jobId ?? undefined }, async () => {
    const result = await sendEmailDetailed({ kind: input.emailKind, to: recipient.email!, subject: content.subject, html: content.html });
    const accepted = result.ok && Boolean(result.externalId);
    outcome = { ...base, state: result.skipped ? "skipped" : result.ok ? "provider_accepted" : "failed", errorCode: result.ok ? null : result.skipped ? "email_preference_or_suppression" : "email_rejected" };
    // Record the direct send so the delivery log shows it; the provider webhook
    // later updates deliveryStatus by externalId (delivered / bounced / opened).
    await db.notification.create({ data: {
      userId: recipient.id, jobId: input.jobId, channel: "EMAIL", subject: content.subject, body: input.body,
      status: result.ok ? "SENT" : "FAILED", sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "Email delivery failed.",
      externalId: result.externalId ?? undefined, deliveryStatus: accepted ? "PENDING" : undefined,
    } });
  });
  return outcome;
}

export async function sendOfficeNotification(input: OfficeSendInput): Promise<RecipientOutcome[]> {
  const plans = await planAndEnqueue(input);
  const inboxIds = plans.flatMap((plan) => (plan.inboxIntentId ? [plan.inboxIntentId] : []));
  const inbox = inboxIds.length ? await deliverInboxIntentsNow(inboxIds) : new Map();
  const outcomes: RecipientOutcome[] = [];
  for (const plan of plans) {
    const name = displayName(plan.recipient);
    if (plan.inboxIntentId) {
      const result = inbox.get(plan.inboxIntentId) ?? { state: "queued", errorCode: null };
      outcomes.push({ userId: plan.recipient.id, name, transport: "INBOX", path: "pipeline", state: result.state, errorCode: "errorCode" in result ? result.errorCode : null });
      if (!plan.inboxOnly && !plan.outcomes.some((outcome) => outcome.transport === "MOBILE_PUSH")) {
        // The phone push is queued in the mobile outbox only once the inbox row exists.
        outcomes.push({ userId: plan.recipient.id, name, transport: "MOBILE_PUSH", path: "pipeline", state: result.state === "inbox_available" ? "queued" : result.state === "skipped" ? "skipped" : "queued", errorCode: null });
      }
    }
    outcomes.push(...plan.outcomes);
    if (plan.directWebPush) outcomes.push(await sendDirectWebPush(input, plan.recipient).catch((): RecipientOutcome => ({ userId: plan.recipient.id, name, transport: "WEB_PUSH", path: "direct", state: "uncertain", errorCode: "provider_outcome_unknown" })));
    if (plan.directEmail) outcomes.push(await sendDirectEmail(input, plan.recipient).catch((): RecipientOutcome => ({ userId: plan.recipient.id, name, transport: "EMAIL", path: "direct", state: "uncertain", errorCode: "provider_outcome_unknown" })));
  }
  return outcomes;
}

/** True when the outcome means the transport took the message (not proof of delivery). */
export function outcomeTaken(outcome: RecipientOutcome): boolean {
  return ["queued", "inbox_available", "provider_accepted", "requested", "already_requested"].includes(outcome.state);
}
