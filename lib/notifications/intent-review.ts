import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { notificationEnvelopeSchema, MAX_DELIVERY_ATTEMPTS } from "./intent-contract";
import { NotificationIntentError } from "./intent-store";

export const intentReviewSchema = z.object({
  id: z.string().min(1).max(200), updatedAt: z.string().datetime(),
  action: z.enum(["RECORD_INVESTIGATION", "RECONCILE_INBOX", "RETRY_KNOWN_REJECTION"]),
  note: z.string().trim().min(1).max(1000),
}).strict();

export async function reviewNotificationIntent(actorId: string, input: unknown) {
  const request = intentReviewSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "NotificationIntent" WHERE "id" = ${request.id} FOR UPDATE`;
    const intent = await tx.notificationIntent.findUnique({ where: { id: request.id }, include: { attempts: { orderBy: { number: "desc" }, take: 1 } } });
    if (!intent) throw new NotificationIntentError(404, "Delivery intent not found.");
    if (intent.updatedAt.toISOString() !== request.updatedAt || !["FAILED", "UNCERTAIN"].includes(intent.status)) throw new NotificationIntentError(409, "Delivery changed. Refresh before reviewing.");
    const now = new Date(Math.max(Date.now(), intent.updatedAt.getTime() + 1));
    let status = intent.status;
    let nextAttemptAt: Date | null = null;
    let notificationId = intent.notificationId;
    if (request.action === "RETRY_KNOWN_REJECTION") {
      if (intent.status !== "FAILED" || intent.attempts[0]?.status !== "NOT_ACCEPTED" || intent.attemptCount >= MAX_DELIVERY_ATTEMPTS) throw new NotificationIntentError(409, "Only a recorded rejection below the attempt limit can be retried.");
      status = "RETRY_WAIT"; nextAttemptAt = now;
    }
    if (request.action === "RECONCILE_INBOX") {
      if (intent.transport !== "INBOX") throw new NotificationIntentError(409, "External delivery requires provider investigation. It cannot be blindly retried.");
      const envelope = notificationEnvelopeSchema.parse(intent.envelope);
      const receipt = await tx.notification.findUnique({ where: { id: `intent-${intent.id}` } });
      if (receipt) {
        if (receipt.userId !== envelope.recipient.userId || receipt.channel !== "PUSH" || receipt.subject !== envelope.subject || receipt.body !== envelope.body || receipt.jobId !== envelope.jobId) throw new NotificationIntentError(409, "Inbox receipt does not match this event. Investigate before proceeding.");
        status = "ACCEPTED"; notificationId = receipt.id;
      } else {
        if (notificationId || intent.attemptCount >= MAX_DELIVERY_ATTEMPTS) throw new NotificationIntentError(409, "Inbox receipt requires investigation or the attempt limit was reached.");
        // Inbox insertion+acceptance is atomic. With this row locked, no receipt
        // and no historical receipt ID prove there was no local insertion.
        status = "RETRY_WAIT"; nextAttemptAt = now;
      }
    }
    await tx.auditLog.create({ data: { userId: actorId, action: `NOTIFICATION_INTENT_${request.action}`, entity: "NotificationIntent", entityId: intent.id,
      before: { status: intent.status, updatedAt: request.updatedAt }, after: { status, note: request.note, notificationId } } });
    return tx.notificationIntent.update({ where: { id: intent.id }, data: { status, nextAttemptAt, notificationId, updatedAt: now } });
  });
}
