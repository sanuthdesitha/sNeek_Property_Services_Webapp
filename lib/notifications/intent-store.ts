import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notificationEnvelopeSchema, notificationEnvelopeHash, notificationIntentKey, DELIVERY_LEASE_MS, MAX_DELIVERY_ATTEMPTS, deliveryAttemptTransition, type DeliveryAttemptOutcome } from "./intent-contract";
import { deliverProviderIntent, enabledIntentProviderTransports } from "./intent-provider";
import { canDeliverNotification } from "./preferences";
import { getAppSettings } from "@/lib/settings";
import { audienceForRole, isChannelAllowed } from "./audience-controls";

export class NotificationIntentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Call inside the authorized domain mutation's transaction, with its stable receipt ID. */
export async function enqueueNotificationIntent(tx: Prisma.TransactionClient, input: unknown) {
  const envelope = notificationEnvelopeSchema.parse(input);
  const idempotencyKey = notificationIntentKey(envelope);
  const envelopeHash = notificationEnvelopeHash(envelope);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
  const existing = await tx.notificationIntent.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.envelopeHash !== envelopeHash) throw new NotificationIntentError(409, "Notification event already exists with different content.");
    return existing;
  }
  return tx.notificationIntent.create({ data: {
    idempotencyKey, envelopeHash, eventId: envelope.eventId, eventKey: envelope.eventKey,
    recipientId: envelope.recipient.userId, transport: envelope.transport, envelope,
  } });
}

export async function claimNotificationIntent(id: string, now = new Date()) {
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "NotificationIntent" WHERE "id" = ${id} FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return null;
    const intent = await tx.notificationIntent.findUniqueOrThrow({ where: { id } });
    if (!["QUEUED", "RETRY_WAIT"].includes(intent.status) || !intent.nextAttemptAt || intent.nextAttemptAt > now || intent.attemptCount >= MAX_DELIVERY_ATTEMPTS) return null;
    const token = randomUUID(); const number = intent.attemptCount + 1;
    const claimed = await tx.notificationIntent.update({ where: { id }, data: {
      status: "PROCESSING", attemptCount: number, leaseToken: token,
      leaseUntil: new Date(now.getTime() + DELIVERY_LEASE_MS), nextAttemptAt: null,
    } });
    await tx.notificationAttempt.create({ data: { intentId: id, number, leaseToken: token, status: "STARTED", startedAt: now } });
    return claimed;
  });
}

async function finish(tx: Prisma.TransactionClient, intent: { id: string; attemptCount: number; leaseToken: string | null }, outcome: DeliveryAttemptOutcome, now: Date, notificationId?: string) {
  const next = deliveryAttemptTransition(outcome, intent.attemptCount, now);
  await tx.notificationAttempt.update({ where: { intentId_number: { intentId: intent.id, number: intent.attemptCount } }, data: {
    status: outcome.kind, finishedAt: now,
    providerReference: outcome.kind === "ACCEPTED" ? outcome.providerReference ?? null : null,
    errorCode: outcome.kind === "ACCEPTED" ? null : outcome.errorCode,
  } });
  return tx.notificationIntent.update({ where: { id: intent.id }, data: {
    ...next, leaseToken: null, leaseUntil: null,
    lastErrorCode: outcome.kind === "ACCEPTED" ? null : outcome.errorCode,
    ...(notificationId ? { notificationId } : {}),
  } });
}

/** Lease-checked completion: a stale provider callback cannot overwrite reconciliation. */
export async function finishNotificationAttempt(id: string, token: string, outcome: DeliveryAttemptOutcome, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "NotificationIntent" WHERE "id" = ${id} FOR UPDATE`;
    const intent = await tx.notificationIntent.findUnique({ where: { id } });
    if (!intent || intent.status !== "PROCESSING" || intent.leaseToken !== token) throw new NotificationIntentError(409, "Delivery attempt changed; reconcile before retrying.");
    return finish(tx, intent, outcome, now);
  });
}

/** First concrete adapter: inbox insertion and acceptance ledger commit together. No device push. */
export async function deliverInboxIntent(id: string, token: string, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "NotificationIntent" WHERE "id" = ${id} FOR UPDATE`;
    const intent = await tx.notificationIntent.findUnique({ where: { id } });
    if (!intent || intent.status !== "PROCESSING" || intent.leaseToken !== token) throw new NotificationIntentError(409, "Delivery attempt changed; reconcile before retrying.");
    const parsed = notificationEnvelopeSchema.safeParse(intent.envelope);
    if (!parsed.success || parsed.data.transport !== "INBOX" || notificationEnvelopeHash(parsed.data) !== intent.envelopeHash) {
      return finish(tx, intent, { kind: "NOT_ACCEPTED", retryable: false, errorCode: "invalid_envelope" }, now);
    }
    const envelope = parsed.data;
    // Each domain scope needs a current authorization adapter. Do not generalize
    // the admin producer's role-only rule to clients, VA teams or assignments.
    if (envelope.recipient.scope.kind !== "ADMIN_OPERATIONS" || !["ADMIN", "OPS_MANAGER"].includes(envelope.recipient.role)) {
      return finish(tx, intent, { kind: "SKIPPED", errorCode: "unsupported_recipient_scope" }, now);
    }
    // Serialize active/role changes through the local inbox disclosure commit.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${envelope.recipient.userId} FOR SHARE`;
    const recipient = await tx.user.findUnique({ where: { id: envelope.recipient.userId }, select: { role: true, isActive: true } });
    if (!recipient?.isActive || recipient.role !== envelope.recipient.role) {
      return finish(tx, intent, { kind: "SKIPPED", errorCode: "recipient_unavailable" }, now);
    }
    if (envelope.templateRecipientRole) {
      const preference = await tx.notificationPreference.findUnique({ where: { eventKey_recipientRole_channel: { eventKey: envelope.eventKey, recipientRole: envelope.templateRecipientRole, channel: "PUSH" } } });
      if (preference && !preference.enabled) return finish(tx, intent, { kind: "SKIPPED", errorCode: "event_preference" }, now);
    }
    if (envelope.category) {
      const allowed = await canDeliverNotification({ userId: envelope.recipient.userId, role: recipient.role, category: envelope.category, channel: "WEB" });
      const settings = await getAppSettings();
      if (!allowed || !isChannelAllowed(settings.notificationAudienceControls, audienceForRole(recipient.role), "push")) return finish(tx, intent, { kind: "SKIPPED", errorCode: "recipient_preference" }, now);
    }
    const notification = await tx.notification.create({ data: {
      id: `intent-${intent.id}`, userId: envelope.recipient.userId, jobId: envelope.jobId,
      channel: "PUSH", status: "SENT", sentAt: now, subject: envelope.subject, body: envelope.body,
    } });
    return finish(tx, intent, { kind: "ACCEPTED" }, now, notification.id);
  });
}

/** Confirm the atomic inbox transaction rolled back before allowing a local retry. */
export async function reconcileInboxFailure(id: string, token: string, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "NotificationIntent" WHERE "id" = ${id} FOR UPDATE`;
    const intent = await tx.notificationIntent.findUnique({ where: { id } });
    if (!intent || intent.status !== "PROCESSING" || intent.leaseToken !== token) return;
    const receipt = await tx.notification.findUnique({ where: { id: `intent-${id}` }, select: { id: true } });
    // Lock acquisition waits for the original DB transaction to settle. Only
    // INBOX has no external side effect outside that atomic transaction.
    if (intent.transport === "INBOX" && !receipt) return finish(tx, intent, { kind: "NOT_ACCEPTED", retryable: true, errorCode: "inbox_transaction_rolled_back" }, now);
    return finish(tx, intent, { kind: "UNCERTAIN", errorCode: "inbox_receipt_requires_reconciliation" }, now);
  });
}

/** Never turn a lost lease into an automatic duplicate send. */
export async function reconcileExpiredNotificationLeases(now = new Date()) {
  const expired = await db.notificationIntent.findMany({ where: { status: "PROCESSING", leaseUntil: { lte: now } }, select: { id: true, leaseToken: true }, take: 50 });
  for (const intent of expired) {
    if (!intent.leaseToken) continue;
    try { await finishNotificationAttempt(intent.id, intent.leaseToken, { kind: "UNCERTAIN", errorCode: "lease_expired" }, now); }
    catch (error) { if (!(error instanceof NotificationIntentError && error.status === 409)) throw error; }
  }
}

/** Invoked by the existing dedicated worker and its web fallback. */
export async function dispatchNotificationIntents(now = new Date()) {
  await reconcileExpiredNotificationLeases(now);
  const due = await db.notificationIntent.findMany({ where: { transport: { in: ["INBOX", ...enabledIntentProviderTransports()] }, status: { in: ["QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: 25 });
  for (const intent of due) {
    let claimed;
    try { claimed = await claimNotificationIntent(intent.id, now); }
    catch { continue; /* A failed claim has not called a provider; any uncertain commit retains its lease. */ }
    if (!claimed?.leaseToken) continue;
    if (claimed.transport !== "INBOX") {
      try {
        const parsed = notificationEnvelopeSchema.safeParse(claimed.envelope);
        const outcome: DeliveryAttemptOutcome = parsed.success && notificationEnvelopeHash(parsed.data) === claimed.envelopeHash
          ? await deliverProviderIntent(parsed.data) : { kind: "NOT_ACCEPTED", retryable: false, errorCode: "invalid_envelope" };
        await finishNotificationAttempt(claimed.id, claimed.leaseToken, outcome, new Date());
      } catch { /* External outcome may have succeeded. Retain lease for uncertain reconciliation. */ }
      continue;
    }
    try { await deliverInboxIntent(claimed.id, claimed.leaseToken, now); }
    catch {
      // A failed intent must not starve other recipients. If the database is
      // unavailable even for reconciliation, retain the lease for the sweep.
      try { await reconcileInboxFailure(claimed.id, claimed.leaseToken, now); } catch { /* No unproven retry. */ }
    }
  }
}
