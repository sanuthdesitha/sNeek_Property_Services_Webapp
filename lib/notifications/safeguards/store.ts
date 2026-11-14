import "server-only";
/**
 * Sending safeguards: the stored limits and emergency stop (one AppSetting
 * row, read on every send so every replica and the worker agree), and the
 * pauses (OutboundSafeguardIncident rows). Every change is audited with the
 * actor; callers have already checked the session (ADMIN, not impersonating)
 * and, where required, the person's own PIN.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { catalogEntry } from "../catalog";
import { isPausableTypeKey } from "./classify";
import {
  DEFAULT_SAFEGUARD_SETTINGS,
  limitsOutOfBounds,
  normalizeSafeguardLimits,
  normalizeSafeguardSettings,
  type SafeguardLimits,
  type SafeguardSettings,
} from "./config";

export const SAFEGUARD_SETTINGS_KEY = "notificationSafeguards";

export class SafeguardInputError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" "));
  }
}

export class SafeguardConflictError extends Error {
  constructor() {
    super("The safeguards were changed by someone else. Reload to see the current limits.");
  }
}

type Client = Prisma.TransactionClient | typeof db;

export async function readSafeguardSettings(client: Client = db): Promise<SafeguardSettings> {
  const row = await client.appSetting.findUnique({ where: { key: SAFEGUARD_SETTINGS_KEY }, select: { value: true } });
  return row ? normalizeSafeguardSettings(row.value) : DEFAULT_SAFEGUARD_SETTINGS;
}

async function lockSettings(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SAFEGUARD_SETTINGS_KEY}))`;
}

async function writeSettings(tx: Prisma.TransactionClient, next: SafeguardSettings) {
  const value = next as unknown as Prisma.InputJsonValue;
  await tx.appSetting.upsert({ where: { key: SAFEGUARD_SETTINGS_KEY }, create: { key: SAFEGUARD_SETTINGS_KEY, value }, update: { value } });
}

/** Save new limits. Out-of-bounds values are refused (never silently clamped). */
export async function saveSafeguardLimits(actorId: string, submitted: unknown, expectedUpdatedAt: string | null, now = new Date()): Promise<SafeguardSettings> {
  const problems = limitsOutOfBounds(submitted);
  if (problems.length) throw new SafeguardInputError(problems);
  const limits: SafeguardLimits = normalizeSafeguardLimits(submitted);
  return db.$transaction(async (tx) => {
    await lockSettings(tx);
    const current = await readSafeguardSettings(tx);
    if ((current.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) throw new SafeguardConflictError();
    const next: SafeguardSettings = { ...current, limits, updatedAt: now.toISOString() };
    await writeSettings(tx, next);
    await tx.auditLog.create({ data: {
      userId: actorId, action: "NOTIFICATION_SAFEGUARDS_UPDATED", entity: "AppSetting", entityId: SAFEGUARD_SETTINGS_KEY,
      before: current.limits as unknown as Prisma.InputJsonValue, after: limits as unknown as Prisma.InputJsonValue,
    } });
    return next;
  });
}

/**
 * The one switch: on stops every outbound email, SMS and push except security
 * messages; the inbox keeps working. Off resumes. Audited both ways.
 */
export async function setEmergencyStop(actorId: string, on: boolean, reason: string | null, now = new Date()): Promise<SafeguardSettings> {
  return db.$transaction(async (tx) => {
    await lockSettings(tx);
    const current = await readSafeguardSettings(tx);
    const next: SafeguardSettings = {
      ...current,
      emergencyStop: { on, changedAt: now.toISOString(), changedById: actorId, reason: reason?.trim().slice(0, 300) || null },
      updatedAt: now.toISOString(),
    };
    await writeSettings(tx, next);
    await tx.auditLog.create({ data: {
      userId: actorId, action: on ? "NOTIFICATION_EMERGENCY_STOP_ON" : "NOTIFICATION_EMERGENCY_STOP_OFF", entity: "AppSetting", entityId: SAFEGUARD_SETTINGS_KEY,
      before: current.emergencyStop as unknown as Prisma.InputJsonValue, after: next.emergencyStop as unknown as Prisma.InputJsonValue,
    } });
    return next;
  });
}

export type IncidentScopeKind = "TYPE" | "RECIPIENT" | "SUBJECT" | "JOB_NAME";

/** Serialize changes to one scope across replicas (there is no partial unique index). */
export async function lockScope(tx: Prisma.TransactionClient, scopeKind: string, scopeKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`safeguard-scope:${scopeKind}:${scopeKey}`}))`;
}

/** An administrator pauses a notification type for email, SMS and push. */
export async function pauseNotificationType(actorId: string, typeKey: string, note: string | null) {
  const entry = catalogEntry(typeKey);
  if (!entry || !isPausableTypeKey(typeKey)) throw new SafeguardInputError(["Choose a notification type from the list."]);
  return db.$transaction(async (tx) => {
    await lockScope(tx, "TYPE", typeKey);
    const existing = await tx.outboundSafeguardIncident.findFirst({ where: { status: "ACTIVE", pausesSending: true, scopeKind: "TYPE", scopeKey: typeKey } });
    if (existing) return { incident: existing, created: false };
    const incident = await tx.outboundSafeguardIncident.create({ data: {
      kind: "MANUAL_PAUSE", scopeKind: "TYPE", scopeKey: typeKey, label: entry.name, pausesSending: true, createdById: actorId,
      detail: { note: note?.trim().slice(0, 300) || null } as Prisma.InputJsonValue,
    } });
    await tx.auditLog.create({ data: {
      userId: actorId, action: "NOTIFICATION_TYPE_PAUSED", entity: "OutboundSafeguardIncident", entityId: incident.id,
      after: { typeKey, note: note?.trim().slice(0, 300) || null } as Prisma.InputJsonValue,
    } });
    return { incident, created: true };
  });
}

/**
 * Resume a paused scope (automatic trip or manual pause). Pauses never resume
 * on their own: only this call ends one.
 */
export async function resumeIncident(actorId: string, incidentId: string, note: string | null, now = new Date()) {
  return db.$transaction(async (tx) => {
    const incident = await tx.outboundSafeguardIncident.findUnique({ where: { id: incidentId } });
    if (!incident) return null;
    await lockScope(tx, incident.scopeKind, incident.scopeKey);
    if (incident.status !== "ACTIVE") return incident;
    const resolved = await tx.outboundSafeguardIncident.update({ where: { id: incidentId }, data: {
      status: "RESOLVED", resolvedAt: now, resolvedById: actorId, resolutionNote: note?.trim().slice(0, 300) || null,
    } });
    await tx.auditLog.create({ data: {
      userId: actorId, action: "NOTIFICATION_SAFEGUARD_RESUMED", entity: "OutboundSafeguardIncident", entityId: incidentId,
      before: { status: incident.status, scopeKind: incident.scopeKind, scopeKey: incident.scopeKey } as Prisma.InputJsonValue,
      after: { status: "RESOLVED", note: resolved.resolutionNote } as Prisma.InputJsonValue,
    } });
    return resolved;
  });
}
