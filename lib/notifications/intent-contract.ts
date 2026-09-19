import { createHash } from "node:crypto";
import { Role, NotificationRecipientRole } from "@prisma/client";
import { z } from "zod";
import { EMAIL_AUTO_KIND_KEYS } from "./email-kinds";

const identifier = z.string().trim().min(1).max(200);
export const notificationEnvelopeSchema = z.object({
  version: z.literal(1),
  // Stable domain mutation/receipt ID, never a message body or rounded timestamp.
  eventId: identifier,
  eventKey: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
  entity: z.object({ type: identifier, id: identifier }).strict(),
  actorId: identifier.nullable(),
  recipient: z.object({ userId: identifier, role: z.nativeEnum(Role), scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ADMIN_OPERATIONS") }).strict(),
    z.object({ kind: z.literal("ENTITY"), type: identifier, id: identifier }).strict(),
  ]) }).strict(),
  severity: z.enum(["INFO", "ACTION", "CRITICAL"]),
  transport: z.enum(["INBOX", "EMAIL", "SMS", "WEB_PUSH"]),
  category: z.enum(["account", "jobs", "laundry", "cases", "reports", "quotes", "shopping", "billing", "approvals", "ical"]).optional(),
  subscriptionId: identifier.optional(),
  emailHtml: z.string().min(1).max(100000).optional(),
  emailKind: z.enum(EMAIL_AUTO_KIND_KEYS as [typeof EMAIL_AUTO_KIND_KEYS[number], ...typeof EMAIL_AUTO_KIND_KEYS[number][]]).optional(),
  url: z.string().max(2000).refine(value => {
    if (!value.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
    try { return new URL(value, "https://notification.invalid").origin === "https://notification.invalid"; } catch { return false; }
  }, "Notification links must remain within the application.").optional(),
  templateRecipientRole: z.nativeEnum(NotificationRecipientRole).optional(),
  subject: z.string().max(300).nullable(),
  body: z.string().min(1).max(20000),
  jobId: identifier.nullable(),
}).strict();
export type NotificationEnvelope = z.infer<typeof notificationEnvelopeSchema>;
export function notificationIntentKey(envelope: NotificationEnvelope) {
  return createHash("sha256").update(JSON.stringify([
    envelope.version, envelope.eventId, envelope.eventKey, envelope.entity.type,
    envelope.entity.id, envelope.recipient.userId, envelope.transport, ...(envelope.subscriptionId ? [envelope.subscriptionId] : []),
  ])).digest("hex");
}
export function notificationEnvelopeHash(envelope: NotificationEnvelope) {
  // Parsing normalizes object property order and rejects unknown payload fields.
  return createHash("sha256").update(JSON.stringify(notificationEnvelopeSchema.parse(envelope))).digest("hex");
}

export type DeliveryAttemptOutcome =
  | { kind: "ACCEPTED"; providerReference?: string }
  | { kind: "NOT_ACCEPTED"; retryable: boolean; errorCode: string }
  | { kind: "UNCERTAIN"; errorCode: string }
  | { kind: "SKIPPED"; errorCode: string };
export const MAX_DELIVERY_ATTEMPTS = 5;
export const DELIVERY_LEASE_MS = 2 * 60 * 1000;
export function deliveryAttemptTransition(outcome: DeliveryAttemptOutcome, attempt: number, now: Date) {
  if (outcome.kind === "ACCEPTED") return { status: "ACCEPTED", nextAttemptAt: null } as const;
  if (outcome.kind === "UNCERTAIN") return { status: "UNCERTAIN", nextAttemptAt: null } as const;
  if (outcome.kind === "SKIPPED") return { status: "SKIPPED", nextAttemptAt: null } as const;
  if (!outcome.retryable || attempt >= MAX_DELIVERY_ATTEMPTS) return { status: "FAILED", nextAttemptAt: null } as const;
  const delay = Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempt - 1));
  return { status: "RETRY_WAIT", nextAttemptAt: new Date(now.getTime() + delay) } as const;
}
