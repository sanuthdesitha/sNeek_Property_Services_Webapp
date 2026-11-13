import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decryptSecret, isEncrypted } from "@/lib/security/encryption";
import { aiRoutingSchema, type AiRoutingSettings } from "./routing-schema";

/**
 * The database seam of the AI provider layer: routing settings, provider keys,
 * shared rate-limit counters and the AiCall audit. Everything else in
 * `lib/ai/provider` is pure or calls these functions.
 */

export const AI_ROUTING_KEY = "ai_routing_v1";
export const AI_CREDENTIALS_KEY = "ai_provider_credentials_v1";

export type SecretProvider = "anthropic" | "openai" | "openai_compatible";
export const SECRET_PROVIDERS: readonly SecretProvider[] = ["anthropic", "openai", "openai_compatible"];

/** Stored credential state per provider: absent = environment fallback, null = cleared. */
export const storedCredentialsSchema = z.object({
  anthropic: z.string().nullable().optional(),
  openai: z.string().nullable().optional(),
  openai_compatible: z.string().nullable().optional(),
}).strict();
export type StoredCredentials = z.infer<typeof storedCredentialsSchema>;

const ENV_KEYS: Readonly<Record<SecretProvider, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openai_compatible: "OPENAI_COMPATIBLE_API_KEY",
};

export function environmentSecret(provider: SecretProvider): string | null {
  return process.env[ENV_KEYS[provider]]?.trim() || null;
}

/** null when nothing has been saved yet. A corrupt row fails closed (throws). */
export async function readAiRoutingSettings(): Promise<AiRoutingSettings | null> {
  const row = await db.appSetting.findUnique({ where: { key: AI_ROUTING_KEY } });
  return row ? aiRoutingSchema.parse(row.value) : null;
}

export async function readStoredCredentials(): Promise<StoredCredentials | null> {
  const row = await db.appSetting.findUnique({ where: { key: AI_CREDENTIALS_KEY } });
  return row ? storedCredentialsSchema.parse(row.value) : null;
}

/** Decrypts a saved key, or uses the environment until a key is saved. Never logs the value. */
export async function readProviderSecret(provider: SecretProvider): Promise<string | null> {
  const stored = await readStoredCredentials();
  const value = stored?.[provider];
  if (value === undefined) return environmentSecret(provider);
  if (value === null) return null;
  const decrypted = decryptSecret(value);
  // decryptSecret hands back its input when no key is configured; that must never reach a provider.
  if (!isEncrypted(value) || !decrypted || isEncrypted(decrypted)) {
    throw new Error("A saved AI provider key could not be decrypted. Re-enter it in Settings, AI.");
  }
  return decrypted;
}

/**
 * Atomic fixed-window counter shared by every app replica. Returns false when
 * this call would exceed `limit` within the window. Used by AI features and
 * agent tokens.
 */
export async function reserveRateLimit(key: string, limit: number, windowMs: number, now = new Date()): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitWindow" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitWindow"."count" + 1
    RETURNING "count"`;
  // Opportunistic cleanup of old windows; never blocks the caller.
  if (Math.random() < 0.01) {
    void db.$executeRaw`DELETE FROM "RateLimitWindow" WHERE "windowStart" < ${new Date(now.getTime() - 2 * 86_400_000)}`.catch(() => undefined);
  }
  return Number(rows[0]?.count ?? Number.POSITIVE_INFINITY) <= limit;
}

export type AiCallOutcome =
  | "OK" | "INVALID_OUTPUT" | "TIMEOUT" | "PROVIDER_ERROR" | "RATE_LIMITED"
  | "NOT_CONFIGURED" | "IMAGES_NOT_ALLOWED" | "DISABLED" | "PROVIDER_CHANGED";

/** One audit row per AI request. No prompt, answer, image bytes or personal data. */
export type AiCallRecord = {
  feature: string;
  provider: string;
  model: string;
  actorUserId: string | null;
  agentId: string | null;
  entityType: string | null;
  entityId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  imageCount: number;
  attempts: number;
  latencyMs: number;
  outcome: AiCallOutcome;
  errorCode: string | null;
  costMicroUsd: number | null;
};

/** Best effort: an audit write failure is logged and never turns into an AI result or blocks a person. */
export async function recordAiCall(record: AiCallRecord): Promise<void> {
  try {
    await db.aiCall.create({ data: record });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : "unknown", feature: record.feature, outcome: record.outcome }, "[ai] AiCall audit write failed");
  }
}
