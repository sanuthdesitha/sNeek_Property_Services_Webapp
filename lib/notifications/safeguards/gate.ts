import "server-only";
/**
 * THE SENDING GATE. Every outbound email, SMS, browser push and phone push
 * asks `guardOutbound` immediately before its provider call (email.ts,
 * sms.ts, web-push.ts, mobile-push.ts — the only modules allowed to import a
 * provider client; tests/lib/outbound-provider-imports.test.ts enforces it).
 * The inbox is never capped and never passes here.
 *
 * One decision per message, per person, per transport, taken under a
 * transaction-scoped advisory lock on (transport group, person) so two web
 * replicas and the worker cannot both slip under a cap. The decision is
 * written as an OutboundMessageEvent row in the same transaction; the caps,
 * duplicate checks and the breaker count those rows.
 *
 * A suppressed message is never reported as delivered: callers get
 * `allowed: false` with the reason and store "Not sent (sending safeguard): …".
 * When the gate itself cannot run, NORMAL and BULK messages are not sent
 * (reason SAFEGUARD_UNAVAILABLE); security, urgent and alert messages go.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { deriveTypeKey, messageClassFor, quietPolicyFor, type MessageClass } from "./classify";
import { limitGroupFor, transportsInGroup, type GuardedTransport, type SafeguardSettings, type SuppressionReason } from "./config";
import { decideOutbound, isInQuietHours, type GuardFacts, type PauseHit } from "./decide";
import { readSafeguardSettings } from "./store";

/** What a producer may tell the gate. Only the security class can be asserted. */
export type SafeguardMeta = {
  typeKey?: string | null;
  eventKey?: string | null;
  /** The subject entity as "<Type>:<id>", e.g. "Job:<id>", "LaundryTask:<id>". */
  entityKey?: string | null;
  /**
   * Further subjects one message covers (a combined reminder listing several
   * jobs: "Job:<id>" each). A pause on any of them stops the message, and a
   * message of the same type about any of them sent recently counts as the
   * same subject, exactly as if it had been sent per subject. Never loosens
   * a check: the caps and the duplicate check stay per message and person.
   */
  relatedEntityKeys?: readonly string[] | null;
  recipientUserId?: string | null;
  messageClass?: "SECURITY" | null;
  /**
   * A person in the office deliberately sent this one message (pressed send,
   * chose the transports). Personal switches do not stop it
   * (lib/notifications/personal/enforce.ts); every office-level switch and
   * every safeguard below still applies.
   */
  officeDecision?: boolean;
  /** Internal: a message held over quiet hours being sent once. */
  releasedFromHold?: boolean;
};

/** The payload kept while a message is held over quiet hours. */
export type HeldPayload =
  | { transport: "EMAIL"; to: string; subject: string; html: string; replyTo?: string; from?: string; kind?: string; transactional?: boolean }
  | { transport: "SMS"; to: string; body: string };

export type OutboundRequest = {
  transport: GuardedTransport;
  /** Email address, phone number, or (push) the user id. */
  recipient: string;
  meta?: SafeguardMeta | null;
  hints?: { emailKind?: string | null; category?: string | null };
  subject?: string | null;
  /** The rendered content the duplicate check hashes (subject + body). */
  content: string;
  holdPayload?: HeldPayload | null;
};

export type GuardResult =
  | { allowed: true; eventId: string | null; messageClass: MessageClass }
  | { allowed: false; eventId: string | null; reason: SuppressionReason; held: boolean; messageClass: MessageClass };

export type ProviderOutcome = "ACCEPTED" | "NOT_ACCEPTED" | "UNCERTAIN";

const STAFF_EXCLUDED_ROLES = new Set(["CLIENT", "VA"]);

export function normalizeRecipientKey(transport: GuardedTransport, recipient: string): string {
  const raw = String(recipient ?? "").trim();
  if (transport === "EMAIL") return raw.toLowerCase();
  if (transport === "SMS") {
    const digits = raw.replace(/[^\d+]/g, "");
    if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
    if (/^61\d{9}$/.test(digits)) return `+${digits}`;
    return digits;
  }
  return raw;
}

export function contentHash(subject: string | null | undefined, content: string): string {
  return createHash("sha256").update(`${subject ?? ""}\u0000${content}`).digest("hex");
}

type Account = { id: string; role: string; isActive: boolean };

async function resolveAccount(transport: GuardedTransport, recipient: string, key: string, userIdHint: string | null | undefined): Promise<Account | null> {
  const select = { id: true, role: true, isActive: true } as const;
  if (userIdHint) {
    const byId = await db.user.findUnique({ where: { id: userIdHint }, select });
    if (byId) return { ...byId, role: String(byId.role) };
  }
  if (transport === "EMAIL") {
    const user = await db.user.findFirst({ where: { email: { equals: key, mode: "insensitive" } }, select, orderBy: { isActive: "desc" } });
    return user ? { ...user, role: String(user.role) } : null;
  }
  if (transport === "SMS") {
    const user = await db.user.findFirst({ where: { phone: { in: Array.from(new Set([recipient.trim(), key])) } }, select, orderBy: { isActive: "desc" } });
    return user ? { ...user, role: String(user.role) } : null;
  }
  const user = await db.user.findUnique({ where: { id: key }, select });
  return user ? { ...user, role: String(user.role) } : null;
}

function localClock(now: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { hour, minute };
}

async function organisationTimeZone(): Promise<string> {
  try {
    return (await getAppSettings()).timezone || "Australia/Sydney";
  } catch {
    return "Australia/Sydney";
  }
}

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function pauseFrom(rows: Array<{ scopeKind: string }>): PauseHit | null {
  if (rows.some((row) => row.scopeKind === "RECIPIENT")) return "RECIPIENT";
  if (rows.some((row) => row.scopeKind === "SUBJECT")) return "SUBJECT";
  if (rows.some((row) => row.scopeKind === "TYPE")) return "TYPE";
  return null;
}

type Prepared = {
  transport: GuardedTransport;
  recipientKey: string;
  typeKey: string;
  entityKey: string | null;
  /** The message's own subject first, then any further subjects it covers. */
  subjectKeys: string[];
  subject: string | null;
  hash: string;
  messageClass: MessageClass;
};

const MAX_RELATED_SUBJECTS = 50;

function subjectKeysFor(entityKey: string | null, related: readonly string[] | null | undefined): string[] {
  const keys = new Set<string>(entityKey ? [entityKey] : []);
  for (const raw of (related ?? []).slice(0, MAX_RELATED_SUBJECTS)) {
    const key = String(raw ?? "").trim().slice(0, 160);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

function prepare(request: OutboundRequest): Prepared {
  const meta = request.meta ?? {};
  const typeKey = deriveTypeKey({
    typeKey: meta.typeKey, eventKey: meta.eventKey, emailKind: request.hints?.emailKind,
    subject: request.subject, category: request.hints?.category, transport: request.transport,
  });
  const entityKey = meta.entityKey?.trim().slice(0, 160) || null;
  return {
    transport: request.transport,
    recipientKey: normalizeRecipientKey(request.transport, request.recipient),
    typeKey,
    entityKey,
    subjectKeys: subjectKeysFor(entityKey, meta.relatedEntityKeys),
    subject: request.subject?.trim().slice(0, 160) || null,
    hash: contentHash(request.subject, request.content),
    messageClass: messageClassFor(typeKey, meta.messageClass ?? null),
  };
}

async function decideUnderLock(
  prepared: Prepared,
  request: OutboundRequest,
  settings: SafeguardSettings,
  account: Account | null,
  inQuietHours: boolean,
  now: Date,
) {
  const { limits } = settings;
  const group = limitGroupFor(prepared.transport);
  const groupLimits = limits[group];
  const transports = transportsInGroup(group);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outbound:${group}:${prepared.recipientKey}`}))`;
    const sameRecipient = { transport: { in: transports }, recipientKey: prepared.recipientKey };
    // Without a subject entity or a subject line there is nothing to compare
    // (an SMS has no subject): only the duplicate check and ceilings apply.
    // A message covering several subjects (relatedEntityKeys) matches any of them.
    const subjectMatch: Prisma.OutboundMessageEventWhereInput | null = prepared.subjectKeys.length > 1
      ? { entityKey: { in: prepared.subjectKeys } }
      : prepared.subjectKeys.length === 1
        ? { entityKey: prepared.subjectKeys[0] }
        : prepared.subject ? { subject: prepared.subject } : null;
    const pauseScopes: Prisma.OutboundSafeguardIncidentWhereInput[] = [
      { scopeKind: "TYPE", scopeKey: prepared.typeKey },
      { scopeKind: "RECIPIENT", scopeKey: prepared.recipientKey },
      ...prepared.subjectKeys.map((key) => ({ scopeKind: "SUBJECT", scopeKey: key })),
    ];
    const pauses = await tx.outboundSafeguardIncident.findMany({ where: { status: "ACTIVE", pausesSending: true, OR: pauseScopes }, select: { scopeKind: true } });
    const duplicate = await tx.outboundMessageEvent.count({ where: { recipientKey: prepared.recipientKey, contentHash: prepared.hash, transport: { in: transports }, decision: { in: ["ALLOWED", "HELD"] }, createdAt: { gte: minutesAgo(now, limits.duplicateWindowMinutes) } } });
    const sameSubject = subjectMatch
      ? await tx.outboundMessageEvent.count({ where: { ...sameRecipient, typeKey: prepared.typeKey, ...subjectMatch, decision: { in: ["ALLOWED", "HELD"] }, createdAt: { gte: minutesAgo(now, groupLimits.sameSubjectMinutes) } } })
      : 0;
    const sentLastHour = await tx.outboundMessageEvent.count({ where: { ...sameRecipient, decision: "ALLOWED", createdAt: { gte: minutesAgo(now, 60) } } });
    const sentLastDay = await tx.outboundMessageEvent.count({ where: { ...sameRecipient, decision: "ALLOWED", createdAt: { gte: minutesAgo(now, 24 * 60) } } });
    const alertEmailsLastHour = prepared.messageClass === "ALERT" && prepared.transport === "EMAIL"
      ? await tx.outboundMessageEvent.count({ where: { messageClass: "ALERT", transport: "EMAIL", decision: "ALLOWED", createdAt: { gte: minutesAgo(now, 60) } } })
      : 0;
    const holdable = Boolean(request.holdPayload) && (prepared.transport === "EMAIL" || prepared.transport === "SMS");
    const facts: GuardFacts = {
      transport: prepared.transport,
      messageClass: prepared.messageClass,
      quietPolicy: quietPolicyFor(prepared.typeKey, prepared.messageClass, prepared.transport),
      recipientInactive: account ? !account.isActive : false,
      recipientIsStaff: account ? !STAFF_EXCLUDED_ROLES.has(account.role) : false,
      emergencyStop: settings.emergencyStop.on,
      pause: pauseFrom(pauses),
      duplicateRecently: duplicate > 0,
      sameSubjectRecently: sameSubject > 0,
      sentLastHour,
      sentLastDay,
      alertEmailsLastHour,
      inQuietHours,
      releasedFromHold: request.meta?.releasedFromHold === true,
      holdable,
    };
    const decision = decideOutbound(facts, limits);
    const event = await tx.outboundMessageEvent.create({ data: {
      transport: prepared.transport,
      recipientKey: prepared.recipientKey,
      recipientUserId: account?.id ?? request.meta?.recipientUserId ?? null,
      typeKey: prepared.typeKey,
      entityKey: prepared.entityKey,
      contentHash: prepared.hash,
      messageClass: prepared.messageClass,
      decision: decision.decision,
      reason: decision.decision === "ALLOWED" ? null : decision.reason,
      subject: prepared.subject,
      ...(decision.decision === "HELD" && request.holdPayload ? { heldPayload: request.holdPayload as unknown as Prisma.InputJsonValue } : {}),
    }, select: { id: true } });
    return { decision, eventId: event.id };
  }, { timeout: 15_000 });
}

/** Decide one message to one person on one transport. Never throws. */
export async function guardOutbound(request: OutboundRequest, now = new Date()): Promise<GuardResult> {
  const prepared = prepare(request);
  try {
    const settings = await readSafeguardSettings();
    const account = await resolveAccount(request.transport, request.recipient, prepared.recipientKey, request.meta?.recipientUserId);
    const clock = localClock(now, await organisationTimeZone());
    const inQuietHours = isInQuietHours(clock.hour, clock.minute, settings.limits.quietHours);
    const { decision, eventId } = await decideUnderLock(prepared, request, settings, account, inQuietHours, now);
    if (prepared.messageClass !== "SECURITY" && prepared.messageClass !== "ALERT") {
      // Imported lazily: the breaker's alert sends email through this gate.
      const { evaluateBreaker } = await import("./breaker");
      await evaluateBreaker({ ...prepared, recipientUserId: account?.id ?? null }, settings, now).catch((error: unknown) => {
        logger.error({ err: error, typeKey: prepared.typeKey }, "[safeguards] breaker evaluation failed");
      });
    }
    if (decision.decision === "ALLOWED") return { allowed: true, eventId, messageClass: prepared.messageClass };
    logger.warn({ transport: prepared.transport, typeKey: prepared.typeKey, reason: decision.reason }, "[safeguards] outbound message not sent");
    return { allowed: false, eventId, reason: decision.reason, held: decision.decision === "HELD", messageClass: prepared.messageClass };
  } catch (error) {
    logger.error({ err: error, transport: prepared.transport, typeKey: prepared.typeKey }, "[safeguards] gate unavailable");
    if (prepared.messageClass === "SECURITY" || prepared.messageClass === "URGENT" || prepared.messageClass === "ALERT") {
      return { allowed: true, eventId: null, messageClass: prepared.messageClass };
    }
    return { allowed: false, eventId: null, reason: "SAFEGUARD_UNAVAILABLE", held: false, messageClass: prepared.messageClass };
  }
}

/**
 * A send naming more recipients than the limit is refused whole (one event
 * row records it). Returns null when the count is within the limit.
 */
export async function refuseOversizedSend(transport: GuardedTransport, recipients: string[], subject: string | null, meta?: SafeguardMeta | null): Promise<GuardResult | null> {
  let max: number;
  try {
    max = (await readSafeguardSettings()).limits.maxRecipientsPerSend;
  } catch {
    return null;
  }
  if (recipients.length <= max) return null;
  const typeKey = deriveTypeKey({ typeKey: meta?.typeKey, eventKey: meta?.eventKey, subject, transport });
  const messageClass = messageClassFor(typeKey, meta?.messageClass ?? null);
  let eventId: string | null = null;
  try {
    const event = await db.outboundMessageEvent.create({ data: {
      transport, recipientKey: `(${recipients.length} recipients)`, typeKey, contentHash: contentHash(subject, recipients.join(",")),
      messageClass, decision: "SUPPRESSED", reason: "TOO_MANY_RECIPIENTS", subject: subject?.slice(0, 160) ?? null,
    }, select: { id: true } });
    eventId = event.id;
  } catch (error) {
    logger.error({ err: error }, "[safeguards] could not record an oversized send");
  }
  logger.warn({ transport, recipients: recipients.length, max }, "[safeguards] send refused: too many recipients");
  return { allowed: false, eventId, reason: "TOO_MANY_RECIPIENTS", held: false, messageClass };
}

/** Record what the provider said about an allowed message. Never throws. */
export async function recordOutboundOutcome(eventId: string | null, outcome: ProviderOutcome): Promise<void> {
  if (!eventId) return;
  try {
    await db.outboundMessageEvent.update({ where: { id: eventId }, data: { outcome } });
  } catch (error) {
    logger.warn({ err: error, eventId }, "[safeguards] could not record provider outcome");
  }
}
