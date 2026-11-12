import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { NOTIFICATION_CATALOG, catalogEntry } from "./catalog";
import { NOTIFICATION_TRANSPORTS, type NotificationTransport } from "./catalog-types";

/**
 * Per-type switches that did not exist before the notifications area, kept in
 * one AppSetting row (no schema change). Every value defaults to the behaviour
 * the producer had before the switch existed:
 * - `respectsPreferences`: only for types marked ADMIN_SWITCH. Missing = false
 *   (office-directed messages such as a manual job reminder have always ignored
 *   personal category preferences).
 * - `disabledTransports`: only for types with a TYPE_CONTROL switch. Missing =
 *   nothing disabled.
 */
export const TYPE_CONTROLS_KEY = "notificationTypeControls";

export type NotificationTypeControls = {
  respectsPreferences: Record<string, boolean>;
  disabledTransports: Record<string, NotificationTransport[]>;
};

export type StoredTypeControls = NotificationTypeControls & { updatedAt: string | null };

const transportSchema = z.enum(NOTIFICATION_TRANSPORTS);

export function preferenceSwitchKeys(): string[] {
  return NOTIFICATION_CATALOG.filter((entry) => entry.preferences === "ADMIN_SWITCH").map((entry) => entry.key);
}

export function transportSwitchKeys(): string[] {
  return NOTIFICATION_CATALOG.filter((entry) => entry.switches.some((item) => item.kind === "TYPE_CONTROL")).map((entry) => entry.key);
}

/** Unknown keys and malformed values are dropped, so a bad row can only fall back to the defaults. */
export function sanitizeTypeControls(input: unknown): NotificationTypeControls {
  const row = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const prefsIn = row.respectsPreferences && typeof row.respectsPreferences === "object" ? (row.respectsPreferences as Record<string, unknown>) : {};
  const disabledIn = row.disabledTransports && typeof row.disabledTransports === "object" ? (row.disabledTransports as Record<string, unknown>) : {};
  const respectsPreferences: Record<string, boolean> = {};
  for (const key of preferenceSwitchKeys()) {
    if (typeof prefsIn[key] === "boolean") respectsPreferences[key] = prefsIn[key] as boolean;
  }
  const disabledTransports: Record<string, NotificationTransport[]> = {};
  for (const key of transportSwitchKeys()) {
    const value = disabledIn[key];
    if (!Array.isArray(value)) continue;
    const allowed = new Set(catalogEntry(key)?.transports ?? []);
    const list = value.flatMap((item) => {
      const parsed = transportSchema.safeParse(item);
      return parsed.success && allowed.has(parsed.data) ? [parsed.data] : [];
    });
    if (list.length) disabledTransports[key] = Array.from(new Set(list));
  }
  return { respectsPreferences, disabledTransports };
}

export async function getNotificationTypeControls(): Promise<StoredTypeControls> {
  const row = await db.appSetting.findUnique({ where: { key: TYPE_CONTROLS_KEY }, select: { value: true, updatedAt: true } });
  return { ...sanitizeTypeControls(row?.value), updatedAt: row?.updatedAt?.toISOString() ?? null };
}

export function typeRespectsPreferences(controls: NotificationTypeControls, key: string): boolean {
  return controls.respectsPreferences[key] === true;
}

export function isTransportSwitchedOff(controls: NotificationTypeControls, key: string, transport: NotificationTransport): boolean {
  return (controls.disabledTransports[key] ?? []).includes(transport);
}

export const typeControlsPatchSchema = z.object({
  /** The `updatedAt` the editor loaded; a changed row is refused (409). Null when no row existed. */
  expectedUpdatedAt: z.string().datetime().nullable(),
  respectsPreferences: z.record(z.boolean()).optional(),
  disabledTransports: z.record(z.array(transportSchema)).optional(),
}).strict();

export class TypeControlsConflictError extends Error {
  readonly status = 409;
  constructor() { super("Notification switches changed since you loaded them. Refresh and try again."); }
}

/** ADMIN-only caller (the route checks). Audited with before and after. */
export async function saveNotificationTypeControls(actorId: string, input: unknown): Promise<StoredTypeControls> {
  const patch = typeControlsPatchSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TYPE_CONTROLS_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: TYPE_CONTROLS_KEY }, select: { value: true, updatedAt: true } });
    const currentStamp = row?.updatedAt?.toISOString() ?? null;
    if (currentStamp !== patch.expectedUpdatedAt) throw new TypeControlsConflictError();
    const before = sanitizeTypeControls(row?.value);
    const next = sanitizeTypeControls({
      respectsPreferences: { ...before.respectsPreferences, ...(patch.respectsPreferences ?? {}) },
      disabledTransports: { ...before.disabledTransports, ...(patch.disabledTransports ?? {}) },
    });
    const saved = await tx.appSetting.upsert({
      where: { key: TYPE_CONTROLS_KEY },
      create: { key: TYPE_CONTROLS_KEY, value: next },
      update: { value: next },
      select: { updatedAt: true },
    });
    await tx.auditLog.create({ data: {
      userId: actorId, action: "NOTIFICATION_TYPE_CONTROLS_UPDATED", entity: "AppSetting", entityId: TYPE_CONTROLS_KEY,
      before, after: next,
    } });
    return { ...next, updatedAt: saved.updatedAt.toISOString() };
  });
}
