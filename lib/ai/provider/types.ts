import type { AiFeature, AiProviderKind } from "./routing-schema";

/** An image already loaded and re-encoded on the server. Never a URL. */
export type ProviderImage = {
  id: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string;
  /** Cleaner evidence that may carry the burned-in time/address stamp (lib/uploads/stamp.ts). */
  evidenceStamp?: boolean;
};

export type ProviderUsage = { inputTokens: number | null; outputTokens: number | null };

export type AdapterRequest = {
  model: string;
  instructions: string;
  prompt: string;
  images: ProviderImage[];
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
  apiKey: string | null;
  baseUrl: string | null;
};

export type AdapterResult = { data: unknown; usage: ProviderUsage };

export type ProviderErrorCode =
  | "RATE_LIMITED" | "SERVER" | "TIMEOUT" | "AUTH" | "BAD_REQUEST"
  | "INCOMPLETE" | "INVALID_JSON" | "CONNECTION" | "UNKNOWN";

/** Adapters attach these fields to the errors they throw; messages stay sanitized. */
export type ProviderErrorDetails = { providerCode: ProviderErrorCode; status: number | null; retryAfterMs: number | null };

export class ProviderCallError extends Error implements ProviderErrorDetails {
  constructor(
    public providerCode: ProviderErrorCode,
    message: string,
    public status: number | null = null,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export type AiUnavailableCode = "NOT_CONFIGURED" | "DISABLED" | "IMAGES_NOT_ALLOWED" | "RATE_LIMITED" | "PROVIDER_CHANGED" | "NOT_BUILT";

const UNAVAILABLE_MESSAGES: Readonly<Record<AiUnavailableCode, string>> = {
  NOT_CONFIGURED: "AI unavailable for this feature: the selected provider is not configured. Continue manually.",
  DISABLED: "AI unavailable for this feature: it is switched off in Settings, AI. Continue manually.",
  IMAGES_NOT_ALLOWED: "AI unavailable for this feature: images are not allowed to leave the server. Continue manually, or ask an administrator to choose a local provider.",
  RATE_LIMITED: "AI unavailable for now: the hourly limit for this feature was reached. Continue manually or try again later.",
  PROVIDER_CHANGED: "Photo analysis provider changed. Request a fresh review with the current provider.",
  NOT_BUILT: "AI unavailable: this feature is not built yet.",
};

/** A refusal before any provider call. The message is safe to show to the person. */
export class AiUnavailableError extends Error {
  constructor(public code: AiUnavailableCode, message = UNAVAILABLE_MESSAGES[code]) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function isAiUnavailable(error: unknown, ...codes: AiUnavailableCode[]): error is AiUnavailableError {
  return error instanceof AiUnavailableError && (codes.length === 0 || codes.includes(error.code));
}

export type ResolvedRoute = {
  feature: AiFeature;
  provider: AiProviderKind;
  model: string;
  /** Only for the OpenAI-compatible provider. */
  baseUrl: string | null;
  configured: boolean;
  cloud: boolean;
  enabled: boolean;
  allowImages: boolean;
  timeoutMs: number;
  hourlyLimitPerActor: number;
  /** Where the provider choice came from, for the settings screen. */
  source: "feature" | "default" | "photo-settings" | "environment";
};

export type AiActor =
  | { kind: "user"; userId: string }
  | { kind: "system"; label: string }
  | { kind: "agent"; agentId: string; userId: string | null };

export type AiEntityRef = { type: string; id: string };
