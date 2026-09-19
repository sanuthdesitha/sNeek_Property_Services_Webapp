import "server-only";
import type { Prisma, NotificationRecipientRole } from "@prisma/client";
import type { DeliveryInput } from "./delivery";
import type { NotificationEnvelope } from "./intent-contract";
import { enqueueNotificationIntent, NotificationIntentError } from "./intent-store";

export type DurableDeliveryContext = {
  tx: Prisma.TransactionClient;
  eventId: string;
  eventKey: string;
  entity: NotificationEnvelope["entity"];
  actorId: string | null;
  severity: NotificationEnvelope["severity"];
  scope: NotificationEnvelope["recipient"]["scope"];
  transports?: NotificationEnvelope["transport"][];
  templateRecipientRole?: NotificationRecipientRole;
};

/** Serialize resolved content, never callbacks or addresses. Dispatch rechecks current recipients and preferences. */
export async function queueDelivery(input: DeliveryInput, context: DurableDeliveryContext) {
  const transports = context.transports ?? ["INBOX", "EMAIL", "SMS", "WEB_PUSH"];
  const recipients = Array.from(new Map(input.recipients.map(recipient => [recipient.id, recipient])).values());
  // No role-only authorization assumptions for clients, VA teams or assignments.
  if (context.scope.kind !== "ADMIN_OPERATIONS" || recipients.some(recipient => !recipient.id || !recipient.role || !["ADMIN", "OPS_MANAGER"].includes(recipient.role))) {
    throw new NotificationIntentError(400, "This recipient scope has no durable dispatch authorization adapter.");
  }
  const intents = [];
  for (const recipient of recipients) {
    const base = {
      version: 1 as const, eventId: context.eventId, eventKey: context.eventKey, entity: context.entity,
      actorId: context.actorId, recipient: { userId: recipient.id, role: recipient.role!, scope: context.scope },
      severity: context.severity, category: input.category, jobId: input.jobId ?? null,
      ...(context.templateRecipientRole ? { templateRecipientRole: context.templateRecipientRole } : {}),
    };
    if (transports.includes("INBOX")) intents.push(await enqueueNotificationIntent(context.tx, { ...base, transport: "INBOX", ...input.web }));
    const email = typeof input.email === "function" ? input.email(recipient) : input.email;
    if (transports.includes("EMAIL") && email) intents.push(await enqueueNotificationIntent(context.tx, {
      ...base, transport: "EMAIL", subject: email.subject, body: email.logBody ?? email.subject, emailHtml: email.html,
      ...(input.kind ? { emailKind: input.kind } : {}),
    }));
    const sms = typeof input.sms === "function" ? input.sms(recipient) : input.sms;
    if (transports.includes("SMS") && sms) intents.push(await enqueueNotificationIntent(context.tx, { ...base, transport: "SMS", subject: input.web.subject, body: sms }));
    if (transports.includes("WEB_PUSH")) {
      const subscriptions = await context.tx.pushSubscription.findMany({ where: { userId: recipient.id }, select: { id: true } });
      for (const subscription of subscriptions) intents.push(await enqueueNotificationIntent(context.tx, {
        ...base, transport: "WEB_PUSH", ...input.web, subscriptionId: subscription.id,
        ...(input.url ? { url: input.url } : {}),
      }));
    }
  }
  return intents;
}
