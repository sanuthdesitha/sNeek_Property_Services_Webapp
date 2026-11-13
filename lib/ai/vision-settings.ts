import "server-only";
import { db } from "@/lib/db";
import { getResolvedVisionProviderConfiguration } from "./config";
import { DEFAULT_VISION_SETTINGS, visionSettingsSchema, type VisionSettings } from "./vision-settings-schema";
export type { VisionSettings } from "./vision-settings-schema";
export const VISION_SETTINGS_KEY = "ai_vision_v1";

export async function getVisionSettings(): Promise<VisionSettings> {
  const row = await db.appSetting.findUnique({ where: { key: VISION_SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_VISION_SETTINGS, model: (await getResolvedVisionProviderConfiguration(DEFAULT_VISION_SETTINGS.provider)).model };
  // Invalid stored configuration fails closed instead of enabling paid processing.
  const parsed = visionSettingsSchema.parse(row.value);
  return parsed.provider === "ollama" ? { ...parsed, model: (await getResolvedVisionProviderConfiguration("ollama")).model } : parsed;
}
export async function saveVisionSettings(input: unknown, actorUserId?: string): Promise<VisionSettings> {
  const { snapshotRoute: _queuedOnly, ...parsed } = visionSettingsSchema.parse(input);
  const value = parsed.provider === "ollama" ? { ...parsed, model: (await getResolvedVisionProviderConfiguration("ollama")).model } : parsed;
  const before = actorUserId ? await db.appSetting.findUnique({ where: { key: VISION_SETTINGS_KEY } }) : null;
  await db.appSetting.upsert({ where: { key: VISION_SETTINGS_KEY }, create: { key: VISION_SETTINGS_KEY, value }, update: { value } });
  // Who changed photo checks (switches, thresholds, deduction points). The settings hold no secrets.
  if (actorUserId) await db.auditLog.create({ data: { userId: actorUserId, action: "AI_VISION_SETTINGS_UPDATED", entity: "AppSetting", entityId: VISION_SETTINGS_KEY, before: (before?.value ?? undefined) as never, after: value } });
  return value;
}
