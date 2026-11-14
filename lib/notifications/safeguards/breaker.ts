import "server-only";
/**
 * Sending safeguards: loop / storm detection. After every gate decision the
 * attempts (sent or not) in the short breaker window are counted for the
 * person, the subject (a job, a task) and the type. Crossing a threshold
 * PAUSES that scope for email, SMS and push (inbox copies are kept) and tells
 * administrators once (inbox, plus one email that is itself rate-limited).
 *
 * A pause never resumes on its own: it stays until an administrator resumes
 * it on the Sending safeguards screen (the safer of the two choices; there is
 * no silent cool-down). Further attempts only raise the incident's count.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { catalogEntry } from "../catalog";
import { isPausableTypeKey, type MessageClass } from "./classify";
import { limitGroupFor, transportsInGroup, type GuardedTransport, type SafeguardSettings } from "./config";
import { lockScope, type IncidentScopeKind } from "./store";

export type BreakerInput = {
  transport: GuardedTransport;
  recipientKey: string;
  recipientUserId: string | null;
  typeKey: string;
  entityKey: string | null;
  subject: string | null;
  messageClass: MessageClass;
};

export type TripRequest = {
  kind: "BREAKER" | "WORKER_FAILING";
  scopeKind: IncidentScopeKind;
  scopeKey: string;
  label: string;
  pausesSending: boolean;
  attempts: number;
  detail: Record<string, unknown>;
  sampleRecipients?: string[];
};

/** Mask an address for display: "j***@example.com", "+61****678". */
export function maskRecipient(key: string): string {
  if (key.includes("@")) {
    const [local, domain] = key.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  if (/^\+?\d{6,}$/.test(key)) return `${key.slice(0, 3)}****${key.slice(-3)}`;
  return key;
}

async function recipientLabel(input: BreakerInput): Promise<string> {
  if (input.recipientUserId) {
    const user = await db.user.findUnique({ where: { id: input.recipientUserId }, select: { name: true } }).catch(() => null);
    if (user?.name) return user.name;
  }
  return maskRecipient(input.recipientKey);
}

async function topRecipients(where: Prisma.OutboundMessageEventWhereInput): Promise<string[]> {
  const rows = await db.outboundMessageEvent.groupBy({ by: ["recipientKey"], where, _count: { _all: true }, orderBy: { _count: { recipientKey: "desc" } }, take: 5 });
  return rows.map((row) => `${maskRecipient(row.recipientKey)} (${row._count._all})`);
}

/**
 * Open (or add to) the incident for a scope. Returns the incident and whether
 * this call created it; only the creator alerts administrators, so a storm
 * produces exactly one alert however many replicas see it.
 */
export async function tripIncident(request: TripRequest) {
  const result = await db.$transaction(async (tx) => {
    await lockScope(tx, request.scopeKind, request.scopeKey);
    const existing = await tx.outboundSafeguardIncident.findFirst({ where: { status: "ACTIVE", kind: request.kind, scopeKind: request.scopeKind, scopeKey: request.scopeKey } });
    if (existing) {
      const updated = await tx.outboundSafeguardIncident.update({ where: { id: existing.id }, data: { attemptCount: Math.max(existing.attemptCount, request.attempts) } });
      return { incident: updated, created: false };
    }
    const incident = await tx.outboundSafeguardIncident.create({ data: {
      kind: request.kind, scopeKind: request.scopeKind, scopeKey: request.scopeKey, label: request.label.slice(0, 200),
      pausesSending: request.pausesSending, attemptCount: request.attempts,
      sampleRecipients: (request.sampleRecipients ?? []) as Prisma.InputJsonValue,
      detail: request.detail as Prisma.InputJsonValue,
    } });
    return { incident, created: true };
  });
  if (result.created) {
    logger.error({ incidentId: result.incident.id, scopeKind: request.scopeKind, scopeKey: request.scopeKey, attempts: request.attempts }, "[safeguards] incident opened");
    const { sendSafeguardAlert } = await import("./alerts");
    await sendSafeguardAlert(result.incident.id).catch((error: unknown) => logger.error({ err: error, incidentId: result.incident.id }, "[safeguards] alert failed"));
  }
  return result;
}

export async function evaluateBreaker(input: BreakerInput, settings: SafeguardSettings, now = new Date()) {
  if (input.messageClass === "SECURITY" || input.messageClass === "ALERT") return;
  const { limits } = settings;
  const since = new Date(now.getTime() - limits.breakerWindowMinutes * 60_000);
  const group = limitGroupFor(input.transport);
  const transports = transportsInGroup(group);
  const base = { transport: group, windowMinutes: limits.breakerWindowMinutes, typeKey: input.typeKey, subject: input.subject };

  const toRecipient = await db.outboundMessageEvent.count({ where: { transport: { in: transports }, recipientKey: input.recipientKey, createdAt: { gte: since } } });
  const recipientThreshold = limits[group].breakerPerRecipient;
  if (toRecipient >= recipientThreshold) {
    const types = await db.outboundMessageEvent.groupBy({ by: ["typeKey"], where: { transport: { in: transports }, recipientKey: input.recipientKey, createdAt: { gte: since } }, _count: { _all: true } });
    await tripIncident({
      kind: "BREAKER", scopeKind: "RECIPIENT", scopeKey: input.recipientKey, label: await recipientLabel(input), pausesSending: true,
      attempts: toRecipient, sampleRecipients: [maskRecipient(input.recipientKey)],
      detail: { ...base, threshold: recipientThreshold, types: types.map((row) => ({ typeKey: row.typeKey, attempts: row._count._all })) },
    });
  }

  if (input.entityKey) {
    const aboutSubject = await db.outboundMessageEvent.count({ where: { entityKey: input.entityKey, createdAt: { gte: since } } });
    if (aboutSubject >= limits.breakerPerSubject) {
      await tripIncident({
        kind: "BREAKER", scopeKind: "SUBJECT", scopeKey: input.entityKey, label: input.subject ? `${input.subject} (${input.entityKey})` : input.entityKey, pausesSending: true,
        attempts: aboutSubject, sampleRecipients: await topRecipients({ entityKey: input.entityKey, createdAt: { gte: since } }),
        detail: { ...base, threshold: limits.breakerPerSubject, entityKey: input.entityKey },
      });
    }
  }

  if (input.messageClass !== "BULK" && isPausableTypeKey(input.typeKey)) {
    const ofType = await db.outboundMessageEvent.count({ where: { typeKey: input.typeKey, transport: { in: transports }, createdAt: { gte: since } } });
    if (ofType >= limits.breakerPerType) {
      await tripIncident({
        kind: "BREAKER", scopeKind: "TYPE", scopeKey: input.typeKey, label: catalogEntry(input.typeKey)?.name ?? input.typeKey, pausesSending: true,
        attempts: ofType, sampleRecipients: await topRecipients({ typeKey: input.typeKey, transport: { in: transports }, createdAt: { gte: since } }),
        detail: { ...base, threshold: limits.breakerPerType },
      });
    }
  }
}
