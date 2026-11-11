/**
 * Lost and found settings: the holding period (default 14 days, owner
 * decision 2026-11-11). Stored as one AppSetting row, like the urgent stock
 * reminder settings; changing it is administrator-only and audited.
 */
import { Role, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_HOLDING_DAYS, MAX_HOLDING_DAYS } from "./holding";

export const LOST_FOUND_SETTINGS_KEY = "lost_found_v1:settings";

export const lostFoundSettingsSchema = z.object({
  holdingDays: z.number().int().min(1).max(MAX_HOLDING_DAYS),
}).strict();

export type LostFoundSettings = z.infer<typeof lostFoundSettingsSchema>;

export const DEFAULT_LOST_FOUND_SETTINGS: LostFoundSettings = { holdingDays: DEFAULT_HOLDING_DAYS };

/** A stored value that no longer parses falls back to the default, never to 0. */
export async function readLostFoundSettings(): Promise<LostFoundSettings> {
  const row = await db.appSetting.findUnique({ where: { key: LOST_FOUND_SETTINGS_KEY } });
  const parsed = lostFoundSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_LOST_FOUND_SETTINGS;
}

export async function saveLostFoundSettings(actor: { id: string; role: Role }, raw: unknown): Promise<LostFoundSettings> {
  if (actor.role !== Role.ADMIN) throw new Error("FORBIDDEN");
  const settings = lostFoundSettingsSchema.parse(raw);
  const value = settings as unknown as Prisma.InputJsonValue;
  return db.$transaction(async (tx) => {
    const before = await tx.appSetting.findUnique({ where: { key: LOST_FOUND_SETTINGS_KEY } });
    await tx.appSetting.upsert({ where: { key: LOST_FOUND_SETTINGS_KEY }, create: { key: LOST_FOUND_SETTINGS_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "LOST_FOUND_SETTINGS_UPDATED",
        entity: "AppSetting",
        entityId: LOST_FOUND_SETTINGS_KEY,
        ...(before ? { before: before.value as Prisma.InputJsonValue } : {}),
        after: value,
      },
    });
    return settings;
  });
}
