import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { OfficeActorRole } from "@/lib/notifications/office-send-rules";
import {
  EXTERNAL_MESSAGE_KINDS,
  ExternalMessageError,
  assertExternalAddress,
  idempotencyKeySchema,
  maskContact,
  sendExternalRecipientMessage,
  type ExternalMessageResult,
} from "./external-recipient";

/**
 * "Message guest" for a lost and found item (catalog type `guest.message`).
 *
 * A guest has no account, so it goes through the shared external-recipient
 * path (`external-recipient.ts`): office-initiated only (the routes allow ADMIN,
 * or OPS_MANAGER with the Lost & found pack, and refuse impersonation), tied to an existing lost and found item,
 * rate-limited, one send per idempotency key, audited with a masked address and
 * recorded with the provider's truthful state (accepted, never "delivered").
 */
export const GUEST_MESSAGE_ITEM_DAILY_LIMIT = EXTERNAL_MESSAGE_KINDS["guest.message"].entityDailyLimit;
export const GUEST_MESSAGE_SENDER_HOURLY_LIMIT = EXTERNAL_MESSAGE_KINDS["guest.message"].senderHourlyLimit;

export { maskContact };

/** Kept under its old name for the routes that catch it. */
export const GuestMessageError = ExternalMessageError;
export type GuestMessageError = ExternalMessageError;

export const guestMessageSchema = z.object({
  lostFoundItemId: z.string().trim().min(1).max(200),
  transport: z.enum(["EMAIL", "SMS"]),
  to: z.string().trim().min(3).max(200),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema.optional(),
}).strict();

export type GuestMessageResult = ExternalMessageResult;

/** `actorRole`: the role that allowed the send (ADMIN, or OPS_MANAGER with the Lost & found pack), kept on the audit row. */
export async function sendGuestMessage(actorId: string, input: unknown, now = new Date(), actorRole: OfficeActorRole | null = null): Promise<GuestMessageResult> {
  const request = guestMessageSchema.parse(input);
  assertExternalAddress("guest.message", request.transport, request.to);
  const item = await db.lostFoundItem.findUnique({ where: { id: request.lostFoundItemId }, select: { id: true, itemName: true, jobId: true } });
  if (!item) throw new ExternalMessageError(404, "Lost and found item not found.");
  const sent = await sendExternalRecipientMessage({
    kind: "guest.message",
    actorId,
    entityId: item.id,
    jobId: item.jobId,
    transport: request.transport,
    to: request.to,
    subject: request.subject ?? `About your ${item.itemName}`,
    body: request.body,
    idempotencyKey: request.idempotencyKey,
    audit: { actorRole },
    now,
  });
  return { state: sent.state, errorCode: sent.errorCode };
}
