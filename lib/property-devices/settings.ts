import "server-only";
/**
 * Property device settings (2026-11-20): one AppSetting row, like the lost and
 * found settings. Administrator-only, audited; a save merges into what is
 * stored. A stored value that no longer parses falls back to the defaults,
 * never to 0.
 */
import { Role, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_DEVICE_SETTINGS } from "./charge-policy";
import type { PropertyDeviceSettings } from "./types";

export const PROPERTY_DEVICE_SETTINGS_KEY = "property_devices_v1:settings";

export const propertyDeviceSettingsSchema = z.object({
  defaultThresholdPercent: z.number().int().min(1).max(99),
  staleAfterHours: z.number().int().min(1).max(24 * 30),
  cooldownHours: z.number().int().min(1).max(24 * 30),
  pollIntervalHours: z.number().int().min(1).max(24 * 7),
  failureNoticeAfter: z.number().int().min(1).max(50),
}).strict();

const settingsPatchSchema = propertyDeviceSettingsSchema.partial().strict();

export async function readPropertyDeviceSettings(reader: Pick<Prisma.TransactionClient, "appSetting"> = db): Promise<PropertyDeviceSettings> {
  const row = await reader.appSetting.findUnique({ where: { key: PROPERTY_DEVICE_SETTINGS_KEY } });
  const parsed = propertyDeviceSettingsSchema.safeParse({ ...DEFAULT_DEVICE_SETTINGS, ...((row?.value as Record<string, unknown> | null) ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_DEVICE_SETTINGS;
}

export async function savePropertyDeviceSettings(actor: { id: string; role: Role }, raw: unknown): Promise<PropertyDeviceSettings> {
  if (actor.role !== Role.ADMIN) throw new Error("FORBIDDEN");
  const patch = settingsPatchSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PROPERTY_DEVICE_SETTINGS_KEY}))`;
    const before = await tx.appSetting.findUnique({ where: { key: PROPERTY_DEVICE_SETTINGS_KEY } });
    const current = await readPropertyDeviceSettings(tx);
    const settings = propertyDeviceSettingsSchema.parse({ ...current, ...patch });
    const value = settings as unknown as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key: PROPERTY_DEVICE_SETTINGS_KEY }, create: { key: PROPERTY_DEVICE_SETTINGS_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "PROPERTY_DEVICE_SETTINGS_UPDATED",
        entity: "AppSetting",
        entityId: PROPERTY_DEVICE_SETTINGS_KEY,
        ...(before ? { before: before.value as Prisma.InputJsonValue } : {}),
        after: value,
      },
    });
    return settings;
  });
}
