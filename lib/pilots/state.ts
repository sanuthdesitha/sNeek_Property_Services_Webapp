import "server-only";
/**
 * Pilot features state (lib/pilots/registry.ts), stored in the AppSetting row
 * `pilotFeatures`. Read on the server for every decision, with a cache of at
 * most a few seconds per server process; a failed read counts as every pilot
 * Off (the previous behaviour). Saving clears the cache in this process.
 */
import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  OFF_SETTING,
  allOff,
  parsePilotState,
  pilotApplies,
  type PilotKey,
  type PilotSetting,
  type PilotState,
  type PilotSubject,
  type PilotUpdateInput,
} from "./registry";

export const PILOT_SETTING_KEY = "pilotFeatures";
const CACHE_MS = 5_000;

let cache: { at: number; state: PilotState } | null = null;

export function clearPilotCache(): void {
  cache = null;
}

export async function loadPilotState(now = Date.now()): Promise<PilotState> {
  if (cache && now - cache.at < CACHE_MS) return cache.state;
  let state: PilotState;
  try {
    const row = await db.appSetting.findUnique({ where: { key: PILOT_SETTING_KEY } });
    state = parsePilotState(row?.value ?? null);
  } catch {
    state = allOff(false);
  }
  cache = { at: now, state };
  return state;
}

/** Is this pilot on for this person / property / job, now. Unreadable = Off. */
export async function isPilotOn(key: PilotKey, subject: PilotSubject): Promise<boolean> {
  return pilotApplies(await loadPilotState(), key, subject);
}

export type PilotActor = { id: string; role: Role };

/**
 * Save one pilot. ADMIN only (the route checks the live role); audited with
 * the actual actor. `onSince` moves to now whenever the result is on, so jobs
 * already started keep the flow they started with.
 */
export async function savePilotSetting(actor: PilotActor, input: PilotUpdateInput, now = new Date()): Promise<PilotSetting> {
  const saved = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"pilot-features"}))`;
    const row = await tx.appSetting.findUnique({ where: { key: PILOT_SETTING_KEY } });
    const raw = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Record<string, unknown>) : {};
    const before = parsePilotState(row?.value ?? null).pilots[input.key] ?? OFF_SETTING;
    const next: PilotSetting = {
      mode: input.mode,
      userIds: input.mode === "SCOPED" ? Array.from(new Set(input.userIds)) : [],
      propertyIds: input.mode === "SCOPED" ? Array.from(new Set(input.propertyIds)) : [],
      onSince: input.mode === "OFF" ? null : now.toISOString(),
      changedAt: now.toISOString(),
      changedById: actor.id,
    };
    const value = { ...raw, [input.key]: next } as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key: PILOT_SETTING_KEY }, create: { key: PILOT_SETTING_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "PILOT_FEATURE_CHANGED",
        entity: "PilotFeature",
        entityId: input.key,
        before: before as unknown as Prisma.InputJsonValue,
        after: { ...next, actorRole: actor.role } as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });
  clearPilotCache();
  return saved;
}
