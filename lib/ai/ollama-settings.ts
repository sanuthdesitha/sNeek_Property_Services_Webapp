import "server-only";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/security/encryption";
import { ollamaSettingsSchema, ollamaSettingsInputSchema, type OllamaSettings, type PublicOllamaSettings } from "./ollama-settings-schema";
import { z } from "zod";
export const OLLAMA_SETTINGS_KEY = "ai_ollama_v1";
const storedSchema = ollamaSettingsSchema.extend({ encryptedApiKey: z.string().nullable().optional() }).strict();
export type ResolvedOllamaSettings = OllamaSettings & { apiKey: string | null };
function environmentSettings() {
  return ollamaSettingsSchema.parse({ baseUrl: process.env.OLLAMA_BASE_URL?.trim() || "", textModel: process.env.OLLAMA_TEXT_MODEL?.trim() || "gemma3:4b", visionModel: process.env.OLLAMA_VISION_MODEL?.trim() || "gemma3:4b", useForText: process.env.AI_TEXT_PROVIDER?.trim() === "ollama" });
}
export async function getOllamaSettings(): Promise<ResolvedOllamaSettings> {
  const row = await db.appSetting.findUnique({where:{key:OLLAMA_SETTINGS_KEY}});
  if (!row) return {...environmentSettings(),apiKey:process.env.OLLAMA_API_KEY?.trim() || null};
  const {encryptedApiKey,...settings} = storedSchema.parse(row.value);
  const apiKey = encryptedApiKey === undefined ? process.env.OLLAMA_API_KEY?.trim() || null : encryptedApiKey === null ? null : decryptSecret(encryptedApiKey);
  if (encryptedApiKey && (!isEncrypted(encryptedApiKey) || !apiKey || isEncrypted(apiKey))) throw new Error("The stored Ollama credential could not be decrypted. Re-enter its API key in AI settings.");
  return {...settings,apiKey};
}
export async function getPublicOllamaSettings(): Promise<PublicOllamaSettings> {
  const row = await db.appSetting.findUnique({where:{key:OLLAMA_SETTINGS_KEY}});
  if (!row) return {...environmentSettings(),hasApiKey:Boolean(process.env.OLLAMA_API_KEY?.trim())};
  const {encryptedApiKey,...settings} = storedSchema.parse(row.value);
  return {...settings,hasApiKey:encryptedApiKey === undefined ? Boolean(process.env.OLLAMA_API_KEY?.trim()) : Boolean(encryptedApiKey)};
}
export async function saveOllamaSettings(raw: unknown): Promise<PublicOllamaSettings> {
  const {apiKey,clearApiKey,...settings} = ollamaSettingsInputSchema.parse(raw);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${OLLAMA_SETTINGS_KEY}))`;
    const row = await tx.appSetting.findUnique({where:{key:OLLAMA_SETTINGS_KEY}});
    const previous = row ? storedSchema.parse(row.value) : null;
    const encryptedApiKey = clearApiKey ? null : apiKey ? encryptSecret(apiKey) : previous?.encryptedApiKey;
    const value = {...settings,...(encryptedApiKey !== undefined ? {encryptedApiKey} : {})};
    await tx.appSetting.upsert({where:{key:OLLAMA_SETTINGS_KEY},create:{key:OLLAMA_SETTINGS_KEY,value},update:{value}});
  });
  return getPublicOllamaSettings();
}
