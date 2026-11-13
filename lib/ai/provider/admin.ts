import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/security/encryption";
import { assertSafePublicUrl } from "@/lib/security/ssrf";
import { aiRoutingSaveSchema, aiRoutingSchema, DEFAULT_AI_ROUTING, type AiRoutingSettings } from "./routing-schema";
import {
  AI_CREDENTIALS_KEY, AI_ROUTING_KEY, SECRET_PROVIDERS, environmentSecret, storedCredentialsSchema,
  type SecretProvider, type StoredCredentials,
} from "./store";

/** What the settings screen may see about a key: never the key itself. */
export type PublicCredentialState = {
  provider: SecretProvider;
  state: "saved" | "environment" | "cleared" | "missing" | "unreadable";
  /** Last four characters only, for recognising which key is saved. */
  hint: string | null;
};

function hintOf(secret: string | null): string | null {
  return secret && secret.length >= 12 ? `••••${secret.slice(-4)}` : secret ? "••••" : null;
}

export async function getPublicCredentialStates(): Promise<PublicCredentialState[]> {
  const row = await db.appSetting.findUnique({ where: { key: AI_CREDENTIALS_KEY } });
  const stored: StoredCredentials = row ? storedCredentialsSchema.parse(row.value) : {};
  return SECRET_PROVIDERS.map((provider) => {
    const value = stored[provider];
    if (value === undefined) {
      const fromEnvironment = environmentSecret(provider);
      return { provider, state: fromEnvironment ? "environment" : "missing", hint: hintOf(fromEnvironment) };
    }
    if (value === null) return { provider, state: "cleared", hint: null };
    const decrypted = isEncrypted(value) ? decryptSecret(value) : null;
    if (!decrypted || isEncrypted(decrypted)) return { provider, state: "unreadable", hint: null };
    return { provider, state: "saved", hint: hintOf(decrypted) };
  });
}

export class AiSettingsConflict extends Error {
  constructor(public current: AiRoutingSettings) {
    super("Someone saved AI settings after you opened them.");
  }
}

/**
 * Saves the routing with a stale-write guard (expected revision) under an
 * advisory lock, and records before/after in the audit log. Routing holds no
 * secrets. An OpenAI-compatible base URL must pass the public DNS check.
 */
export async function saveAiRouting(raw: unknown, actorUserId: string): Promise<AiRoutingSettings> {
  const input = aiRoutingSaveSchema.parse(raw);
  if (input.settings.compatible.baseUrl) {
    try {
      await assertSafePublicUrl(input.settings.compatible.baseUrl);
    } catch {
      throw new Error("The OpenAI-compatible address must be a public https address. Use Local Ollama for servers on your own network.");
    }
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${AI_ROUTING_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: AI_ROUTING_KEY } });
    const current = row ? aiRoutingSchema.parse(row.value) : DEFAULT_AI_ROUTING;
    if (current.revision !== input.expectedRevision) throw new AiSettingsConflict(current);
    const next: AiRoutingSettings = aiRoutingSchema.parse({ ...input.settings, revision: current.revision + 1 });
    await tx.appSetting.upsert({ where: { key: AI_ROUTING_KEY }, create: { key: AI_ROUTING_KEY, value: next }, update: { value: next } });
    await tx.auditLog.create({ data: {
      userId: actorUserId, action: "AI_SETTINGS_UPDATED", entity: "AppSetting", entityId: AI_ROUTING_KEY,
      before: current as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue,
    } });
    return next;
  });
}

/**
 * Stores one provider key encrypted (ENCRYPTION_KEY required), or clears it.
 * The caller has already re-checked the administrator's password. The audit
 * names the provider and the action only.
 */
export async function saveAiCredential(input: { provider: SecretProvider; apiKey?: string; clear?: boolean }, actorUserId: string): Promise<void> {
  const apiKey = input.apiKey?.trim() ?? "";
  if (!input.clear && !apiKey) throw new Error("Enter a key, or choose Remove.");
  if (apiKey.length > 4096 || /\s/.test(apiKey)) throw new Error("That does not look like an API key.");
  const encrypted = input.clear ? null : encryptSecret(apiKey);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${AI_CREDENTIALS_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: AI_CREDENTIALS_KEY } });
    const stored: StoredCredentials = row ? storedCredentialsSchema.parse(row.value) : {};
    const next: StoredCredentials = { ...stored, [input.provider]: encrypted };
    await tx.appSetting.upsert({ where: { key: AI_CREDENTIALS_KEY }, create: { key: AI_CREDENTIALS_KEY, value: next }, update: { value: next } });
    await tx.auditLog.create({ data: {
      userId: actorUserId, action: "AI_PROVIDER_KEY_CHANGED", entity: "AppSetting", entityId: AI_CREDENTIALS_KEY,
      after: { provider: input.provider, action: input.clear ? "removed" : "saved" },
    } });
  });
}
