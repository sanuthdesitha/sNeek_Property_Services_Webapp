import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { rateLimit } from "@/lib/security/rate-limit";
import { sendEmailDetailed } from "./email";
import { getSmsProviderState, sendSmsDetailed } from "./sms";
import { dispatchNotificationOnce } from "./dispatch-once";

/**
 * Messages to a person who has no account: a lost and found guest
 * (`guest.message`) or a laundry supplier (`laundry.supplier_chase`).
 *
 * The durable pipeline authorizes account holders, so it cannot carry these.
 * They go through the existing email / SMS chokepoints, which already apply
 * the PUBLIC audience switch, the suppression list and the SMS length cap. On
 * top of that, for every kind:
 * - office-initiated only (each route allows ADMIN, or OPS_MANAGER with the
 *   page's pack at manage, `office-send-rules.ts`, and refuses impersonation);
 * - tied to an existing record of the kind's entity;
 * - rate-limited per sender (in-process) and per record and per sender over a
 *   rolling window counted from the audit log (survives restarts);
 * - one send per idempotency key; audited with a masked address; recorded in
 *   the delivery log with the provider's truthful state (accepted, never
 *   "delivered").
 */
export type ExternalMessageKind = "guest.message" | "laundry.supplier_chase" | "onboarding.client_link";
export type ExternalTransport = "EMAIL" | "SMS";
export type ExternalMessageState = "provider_accepted" | "already_requested" | "skipped" | "failed";

export type ExternalMessageResult = { state: ExternalMessageState; errorCode: string | null };

type KindPolicy = {
  auditAction: string;
  auditEntity: string;
  /** Who is addressed, for error messages ("guest", "supplier"). */
  recipientNoun: string;
  entityDailyLimit: number;
  senderHourlyLimit: number;
  eventPrefix: string;
  logBody: (entityId: string) => string;
  entityTooOften: string;
  senderTooMany: string;
};

export const EXTERNAL_MESSAGE_KINDS: Record<ExternalMessageKind, KindPolicy> = {
  "guest.message": {
    auditAction: "GUEST_MESSAGE_SENT",
    auditEntity: "LostFoundItem",
    recipientNoun: "guest",
    entityDailyLimit: 5,
    senderHourlyLimit: 20,
    eventPrefix: "guest-message",
    logBody: (id) => `Guest message about lost and found item ${id}`,
    entityTooOften: "This item's guest has been messaged too often today.",
    senderTooMany: "Too many guest messages. Try again later.",
  },
  "laundry.supplier_chase": {
    auditAction: "LAUNDRY_SUPPLIER_CHASE_SENT",
    auditEntity: "LaundryTask",
    recipientNoun: "supplier",
    entityDailyLimit: 6,
    senderHourlyLimit: 20,
    eventPrefix: "supplier-chase",
    logBody: (id) => `Laundry supplier chase for run ${id}`,
    entityTooOften: "This run's supplier has been chased too often today.",
    senderTooMany: "Too many supplier messages. Try again later.",
  },
  "onboarding.client_link": {
    auditAction: "ONBOARDING_CLIENT_LINK_SENT",
    auditEntity: "PropertyOnboardingSurvey",
    recipientNoun: "client",
    entityDailyLimit: 6,
    senderHourlyLimit: 20,
    eventPrefix: "onboarding-client-link",
    logBody: (id) => `Onboarding client link for survey ${id}`,
    entityTooOften: "This onboarding's client has been sent too many links today.",
    senderTooMany: "Too many client links. Try again later.",
  },
};

export class ExternalMessageError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const idempotencyKeySchema = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/);

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

export function isValidExternalAddress(transport: ExternalTransport, to: string | null | undefined): boolean {
  if (!to) return false;
  return transport === "EMAIL" ? emailSchema.safeParse(to).success : phonePattern.test(to);
}

/** Refuses an address that cannot be used for the transport (400). */
export function assertExternalAddress(kind: ExternalMessageKind, transport: ExternalTransport, to: string): void {
  if (isValidExternalAddress(transport, to)) return;
  const noun = EXTERNAL_MESSAGE_KINDS[kind].recipientNoun;
  throw new ExternalMessageError(400, transport === "EMAIL" ? `Enter a valid ${noun} email address.` : `Enter a valid ${noun} phone number.`);
}

export type TransportAvailability = { available: boolean; reason: string | null };

/** Whether each provider is configured at all (the address is checked separately). */
export async function externalTransportAvailability(): Promise<Record<ExternalTransport, TransportAvailability>> {
  const email: TransportAvailability = process.env.RESEND_API_KEY?.trim()
    ? { available: true, reason: null }
    : { available: false, reason: "Email is not configured on this server (no email provider key)." };
  const sms = await getSmsProviderState().catch(() => null);
  const smsState: TransportAvailability = !sms
    ? { available: false, reason: "The SMS settings could not be read." }
    : sms.provider === "none"
      ? { available: false, reason: "SMS is switched off in the settings." }
      : !sms.configured
        ? { available: false, reason: "The SMS provider is not configured on this server." }
        : { available: true, reason: null };
  return { EMAIL: email, SMS: smsState };
}

async function recentSends(action: string, where: Prisma.AuditLogWhereInput, since: Date): Promise<number> {
  return db.auditLog.count({ where: { ...where, action, createdAt: { gte: since } } });
}

export type ExternalSendInput = {
  kind: ExternalMessageKind;
  actorId: string;
  entityId: string;
  jobId: string | null;
  transport: ExternalTransport;
  to: string;
  subject: string;
  body: string;
  idempotencyKey?: string;
  /** Extra fields for the audit row (never the full address). */
  audit?: Record<string, unknown>;
  now?: Date;
};

/** Rate limits for one more send of this kind; throws 429 with the kind's wording. */
async function enforceRateLimits(policy: KindPolicy, input: ExternalSendInput, now: Date): Promise<void> {
  if (!rateLimit(`${policy.eventPrefix}:${input.actorId}`, { limit: policy.senderHourlyLimit, windowMs: 60 * 60_000 }).ok) {
    throw new ExternalMessageError(429, policy.senderTooMany);
  }
  const [entityCount, senderCount] = await Promise.all([
    recentSends(policy.auditAction, { entity: policy.auditEntity, entityId: input.entityId }, new Date(now.getTime() - 24 * 60 * 60_000)),
    recentSends(policy.auditAction, { userId: input.actorId }, new Date(now.getTime() - 60 * 60_000)),
  ]);
  if (entityCount >= policy.entityDailyLimit) throw new ExternalMessageError(429, policy.entityTooOften);
  if (senderCount >= policy.senderHourlyLimit) throw new ExternalMessageError(429, policy.senderTooMany);
}

async function deliverEmail(policy: KindPolicy, input: ExternalSendInput): Promise<ExternalMessageResult> {
  const sent = await sendEmailDetailed({ to: input.to, subject: input.subject, html: `<p>${escapeHtml(input.body).replace(/\n/g, "<br>")}</p>` });
  await db.notification.create({ data: {
    userId: null, jobId: input.jobId, channel: "EMAIL", subject: input.subject, body: policy.logBody(input.entityId),
    status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "Email delivery failed.",
    externalId: sent.externalId ?? undefined, deliveryStatus: sent.ok && sent.externalId ? "PENDING" : undefined,
  } });
  return { state: sent.skipped ? "skipped" : sent.ok ? "provider_accepted" : "failed", errorCode: sent.ok ? null : sent.skipped ? "email_suppressed_or_disabled" : "email_rejected" };
}

async function deliverSms(policy: KindPolicy, input: ExternalSendInput): Promise<ExternalMessageResult> {
  const sent = await sendSmsDetailed(input.to, input.body);
  await db.notification.create({ data: {
    userId: null, jobId: input.jobId, channel: "SMS", subject: input.subject, body: policy.logBody(input.entityId),
    status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "SMS delivery failed.",
  } });
  return { state: sent.status === "disabled" ? "skipped" : sent.ok ? "provider_accepted" : "failed", errorCode: sent.ok ? null : `sms_${sent.status}` };
}

/**
 * Sends one message of a kind to one external address. The caller has already
 * checked that the record exists and that the actor may send.
 */
export async function sendExternalRecipientMessage(input: ExternalSendInput): Promise<ExternalMessageResult & { requestId: string }> {
  const policy = EXTERNAL_MESSAGE_KINDS[input.kind];
  const now = input.now ?? new Date();
  assertExternalAddress(input.kind, input.transport, input.to);
  await enforceRateLimits(policy, input, now);

  const requestId = input.idempotencyKey ?? randomUUID();
  let result: ExternalMessageResult = { state: "already_requested", errorCode: null };
  const identity = { event: `${policy.eventPrefix}:${input.entityId}:${requestId}`, day: "office", recipientId: maskContact(input.to) };
  await dispatchNotificationOnce(identity, async () => {
    result = input.transport === "EMAIL" ? await deliverEmail(policy, input) : await deliverSms(policy, input);
  });
  await db.auditLog.create({ data: {
    userId: input.actorId, jobId: input.jobId, action: policy.auditAction, entity: policy.auditEntity, entityId: input.entityId,
    after: {
      ...(input.audit ?? {}),
      transport: input.transport, to: maskContact(input.to), state: result.state, errorCode: result.errorCode, requestId, deliveryConfirmed: false,
    } as Prisma.InputJsonValue,
  } });
  return { ...result, requestId };
}
