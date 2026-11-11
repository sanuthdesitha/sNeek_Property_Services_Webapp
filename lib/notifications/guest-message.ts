import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { rateLimit } from "@/lib/security/rate-limit";
import { sendEmailDetailed } from "./email";
import { sendSmsDetailed } from "./sms";
import { dispatchNotificationOnce } from "./dispatch-once";

/**
 * "Message guest" for a lost and found item (catalog type `guest.message`).
 *
 * A guest has no account, so the durable pipeline (which authorizes account
 * holders) cannot carry it. It goes through the existing email / SMS
 * chokepoints, which already accept any address and apply the PUBLIC
 * audience switch, suppression list and SMS length cap. On top of that:
 * - office-initiated only: the route allows ADMIN only and refuses impersonation;
 * - tied to an existing lost and found item;
 * - rate-limited per sender (in-process) and per item and per sender over a
 *   rolling window counted from the audit log (survives restarts);
 * - one send per idempotency key; audited; recorded in the delivery log with
 *   the provider's truthful state (accepted, never "delivered").
 */
export const GUEST_MESSAGE_ITEM_DAILY_LIMIT = 5;
export const GUEST_MESSAGE_SENDER_HOURLY_LIMIT = 20;
const AUDIT_ACTION = "GUEST_MESSAGE_SENT";

export const guestMessageSchema = z.object({
  lostFoundItemId: z.string().trim().min(1).max(200),
  transport: z.enum(["EMAIL", "SMS"]),
  to: z.string().trim().min(3).max(200),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/).optional(),
}).strict();

export type GuestMessageResult = {
  state: "provider_accepted" | "already_requested" | "skipped" | "failed";
  errorCode: string | null;
};

export class GuestMessageError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const emailSchema = z.string().email();
const phonePattern = /^\+?[0-9 ()-]{8,20}$/;

/** Masks an address for the audit row: enough to recognise, not to reuse. */
export function maskContact(value: string): string {
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 1)}***@${domain}`;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length > 3 ? `***${digits.slice(-3)}` : "***";
}

async function recentSends(where: Prisma.AuditLogWhereInput, since: Date): Promise<number> {
  return db.auditLog.count({ where: { ...where, action: AUDIT_ACTION, createdAt: { gte: since } } });
}

export async function sendGuestMessage(actorId: string, input: unknown, now = new Date()): Promise<GuestMessageResult> {
  const request = guestMessageSchema.parse(input);
  if (request.transport === "EMAIL" && !emailSchema.safeParse(request.to).success) throw new GuestMessageError(400, "Enter a valid guest email address.");
  if (request.transport === "SMS" && !phonePattern.test(request.to)) throw new GuestMessageError(400, "Enter a valid guest phone number.");
  const item = await db.lostFoundItem.findUnique({ where: { id: request.lostFoundItemId }, select: { id: true, itemName: true, jobId: true } });
  if (!item) throw new GuestMessageError(404, "Lost and found item not found.");

  if (!rateLimit(`guest-message:${actorId}`, { limit: GUEST_MESSAGE_SENDER_HOURLY_LIMIT, windowMs: 60 * 60_000 }).ok) {
    throw new GuestMessageError(429, "Too many guest messages. Try again later.");
  }
  const [itemCount, senderCount] = await Promise.all([
    recentSends({ entity: "LostFoundItem", entityId: item.id }, new Date(now.getTime() - 24 * 60 * 60_000)),
    recentSends({ userId: actorId }, new Date(now.getTime() - 60 * 60_000)),
  ]);
  if (itemCount >= GUEST_MESSAGE_ITEM_DAILY_LIMIT) throw new GuestMessageError(429, "This item's guest has been messaged too often today.");
  if (senderCount >= GUEST_MESSAGE_SENDER_HOURLY_LIMIT) throw new GuestMessageError(429, "Too many guest messages. Try again later.");

  const requestId = request.idempotencyKey ?? randomUUID();
  const subject = request.subject ?? `About your ${item.itemName}`;
  let result: GuestMessageResult = { state: "already_requested", errorCode: null };
  await dispatchNotificationOnce({ event: `guest-message:${item.id}:${requestId}`, day: "office", recipientId: maskContact(request.to) }, async () => {
    if (request.transport === "EMAIL") {
      const sent = await sendEmailDetailed({ to: request.to, subject, html: `<p>${escapeHtml(request.body).replace(/\n/g, "<br>")}</p>` });
      result = { state: sent.skipped ? "skipped" : sent.ok ? "provider_accepted" : "failed", errorCode: sent.ok ? null : sent.skipped ? "email_suppressed_or_disabled" : "email_rejected" };
      await db.notification.create({ data: {
        userId: null, jobId: item.jobId, channel: "EMAIL", subject, body: `Guest message about lost and found item ${item.id}`,
        status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "Email delivery failed.",
        externalId: sent.externalId ?? undefined, deliveryStatus: sent.ok && sent.externalId ? "PENDING" : undefined,
      } });
    } else {
      const sent = await sendSmsDetailed(request.to, request.body);
      result = { state: sent.status === "disabled" ? "skipped" : sent.ok ? "provider_accepted" : "failed", errorCode: sent.ok ? null : `sms_${sent.status}` };
      await db.notification.create({ data: {
        userId: null, jobId: item.jobId, channel: "SMS", subject, body: `Guest message about lost and found item ${item.id}`,
        status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "SMS delivery failed.",
      } });
    }
  });
  await db.auditLog.create({ data: {
    userId: actorId, jobId: item.jobId, action: AUDIT_ACTION, entity: "LostFoundItem", entityId: item.id,
    after: { transport: request.transport, to: maskContact(request.to), state: result.state, errorCode: result.errorCode, requestId, deliveryConfirmed: false },
  } });
  return result;
}
