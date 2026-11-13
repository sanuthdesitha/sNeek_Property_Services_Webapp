import "server-only";
import type { z } from "zod";
import { requestOllamaJson } from "@/lib/ai/ollama";
import { requestOpenAiVision } from "@/lib/ai/openai-vision";
import { requestAnthropicStructured } from "./adapters/anthropic";
import { requestCompatibleStructured } from "./adapters/openai-compatible";
import { getAiRouting, resolveFeatureRoute } from "./routing";
import type { AiFeature, AiModelPrice, AiProviderKind } from "./routing-schema";
import { maskEvidenceStamp } from "./stamp-mask";
import { readProviderSecret, recordAiCall, reserveRateLimit, type AiCallOutcome } from "./store";
import {
  AiUnavailableError, ProviderCallError,
  type AdapterRequest, type AdapterResult, type AiActor, type AiEntityRef, type ProviderErrorCode,
  type ProviderImage, type ProviderUsage, type ResolvedRoute,
} from "./types";

export type GenerateStructuredInput<T> = {
  feature: AiFeature;
  actor: AiActor;
  entity?: AiEntityRef;
  instructions: string;
  prompt: string;
  images?: ProviderImage[];
  /** JSON schema sent to the provider (strict, additionalProperties false). */
  jsonSchema: Record<string, unknown>;
  /** The domain validator. Refinements count: a failure gets one repair request. */
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  /** Queued work: the model snapshot taken when it was queued. */
  modelOverride?: string;
  /** Queued work: refuse when the feature's provider has changed since queueing. */
  expectedProvider?: AiProviderKind;
  /**
   * Settings, AI connection tests only: the images are generated colour cards
   * with no property content, so the cloud image switch does not apply.
   */
  syntheticImagesOnly?: boolean;
};

export type GenerateStructuredResult<T> = { data: T; route: ResolvedRoute; usage: ProviderUsage; attempts: number };

const MAX_TRANSIENT_RETRIES = 2;
const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>(["RATE_LIMITED", "SERVER"]);

export function actorKey(actor: AiActor): string {
  if (actor.kind === "user") return `user:${actor.userId}`;
  if (actor.kind === "agent") return `agent:${actor.agentId}`;
  return `system:${actor.label}`;
}

function errorCodeOf(error: unknown): ProviderErrorCode {
  const code = (error as { providerCode?: unknown })?.providerCode;
  return typeof code === "string" ? code as ProviderErrorCode : "UNKNOWN";
}

function outcomeFor(code: ProviderErrorCode): AiCallOutcome {
  if (code === "TIMEOUT") return "TIMEOUT";
  if (code === "INVALID_JSON") return "INVALID_OUTPUT";
  return "PROVIDER_ERROR";
}

/** USD micro-units from an owner-entered price; null (Not known) when no price is saved. Local Ollama has no provider charge. */
export function estimateCostMicroUsd(provider: AiProviderKind, model: string, usage: ProviderUsage, prices: readonly AiModelPrice[]): number | null {
  if (provider === "ollama") return 0;
  const price = prices.find((item) => item.provider === provider && item.model === model);
  if (!price || usage.inputTokens === null || usage.outputTokens === null) return null;
  return Math.round(usage.inputTokens * price.inputUsdPerMillion + usage.outputTokens * price.outputUsdPerMillion);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAdapter(provider: AiProviderKind, request: AdapterRequest): Promise<AdapterResult> {
  if (provider === "anthropic") return requestAnthropicStructured(request);
  if (provider === "openai_compatible") return requestCompatibleStructured(request);
  let usage: ProviderUsage = { inputTokens: null, outputTokens: null };
  const onUsage = (value: ProviderUsage) => { usage = value; };
  const shared = { model: request.model, instructions: request.instructions, prompt: request.prompt, images: request.images, schema: request.jsonSchema, onUsage };
  const data = provider === "openai"
    ? await requestOpenAiVision({ ...shared, apiKey: request.apiKey, timeoutMs: request.timeoutMs, maxOutputTokens: request.maxOutputTokens })
    // Ollama keeps its own deadline, size limits and local-only checks (lib/ai/ollama.ts).
    : await requestOllamaJson(shared);
  return { data, usage };
}

function addUsage(total: ProviderUsage, next: ProviderUsage): ProviderUsage {
  return {
    inputTokens: total.inputTokens === null || next.inputTokens === null ? (total.inputTokens ?? next.inputTokens) : total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens === null || next.outputTokens === null ? (total.outputTokens ?? next.outputTokens) : total.outputTokens + next.outputTokens,
  };
}

/** Field paths only; never the model's answer. */
function repairHint(error: z.ZodError): string {
  return error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ").slice(0, 1000);
}

/**
 * The one way the application asks a model for structured data.
 *
 * Refuses before any request when the feature is off, the provider is not
 * configured or changed since queueing, photos may not leave the server, or the
 * hourly limit is used up (AiUnavailableError, safe to show). Retries only
 * 429/5xx (at most twice; never Ollama), validates with the domain schema and
 * makes one repair request when the answer does not match. Every request
 * writes one AiCall row with no prompt, answer or image bytes. Provider errors
 * are rethrown as the adapter's sanitized error; callers keep their messages.
 */
export async function generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>> {
  const started = Date.now();
  const routing = await getAiRouting();
  const route = await resolveFeatureRoute(input.feature, routing);
  const model = input.modelOverride ?? route.model;
  const images = input.images ?? [];
  const audit = (outcome: AiCallOutcome, extra: Partial<{ usage: ProviderUsage; attempts: number; errorCode: string | null }> = {}) => recordAiCall({
    feature: input.feature,
    provider: route.provider,
    model,
    actorUserId: input.actor.kind === "user" ? input.actor.userId : input.actor.kind === "agent" ? input.actor.userId : null,
    agentId: input.actor.kind === "agent" ? input.actor.agentId : null,
    entityType: input.entity?.type ?? null,
    entityId: input.entity?.id ?? null,
    inputTokens: extra.usage?.inputTokens ?? null,
    outputTokens: extra.usage?.outputTokens ?? null,
    imageCount: images.length,
    attempts: extra.attempts ?? 0,
    latencyMs: Date.now() - started,
    outcome,
    errorCode: extra.errorCode ?? null,
    costMicroUsd: outcome === "OK" || extra.usage ? estimateCostMicroUsd(route.provider, model, extra.usage ?? { inputTokens: null, outputTokens: null }, routing.prices) : null,
  });
  const refuse = async (code: ConstructorParameters<typeof AiUnavailableError>[0], outcome: AiCallOutcome): Promise<never> => {
    await audit(outcome, { errorCode: code });
    throw new AiUnavailableError(code);
  };

  if (!route.enabled) await refuse("DISABLED", "DISABLED");
  if (input.expectedProvider && input.expectedProvider !== route.provider) await refuse("PROVIDER_CHANGED", "PROVIDER_CHANGED");
  if (!route.configured) await refuse("NOT_CONFIGURED", "NOT_CONFIGURED");
  if (images.length && !route.allowImages && !input.syntheticImagesOnly) await refuse("IMAGES_NOT_ALLOWED", "IMAGES_NOT_ALLOWED");
  if (!(await reserveRateLimit(`ai:${input.feature}:${actorKey(input.actor)}`, route.hourlyLimitPerActor, 3_600_000))) await refuse("RATE_LIMITED", "RATE_LIMITED");

  const apiKey = route.provider === "ollama" ? null : await readProviderSecret(route.provider);
  // Cloud only: hide the burned-in time/address stamp on cleaner evidence before it leaves the server.
  const prepared = route.cloud ? await Promise.all(images.map((image) => (image.evidenceStamp ? maskEvidenceStamp(image) : image))) : images;
  const baseRequest: AdapterRequest = {
    model, instructions: input.instructions, prompt: input.prompt, images: prepared, jsonSchema: input.jsonSchema,
    maxOutputTokens: input.maxOutputTokens, timeoutMs: route.timeoutMs, apiKey, baseUrl: route.baseUrl,
  };

  let usage: ProviderUsage = { inputTokens: null, outputTokens: null };
  let attempts = 0;
  const send = async (request: AdapterRequest): Promise<unknown> => {
    for (let transient = 0; ; transient++) {
      attempts++;
      try {
        const result = await callAdapter(route.provider, request);
        usage = addUsage(usage, result.usage);
        return result.data;
      } catch (error) {
        const code = errorCodeOf(error);
        if (route.provider === "ollama" || !RETRYABLE.has(code) || transient >= MAX_TRANSIENT_RETRIES) throw error;
        const retryAfter = (error as ProviderCallError).retryAfterMs;
        await sleep(retryAfter ?? 500 * 3 ** transient);
      }
    }
  };

  let lastError: unknown;
  for (let repair = 0; repair < 2; repair++) {
    const request = repair === 0 ? baseRequest : {
      ...baseRequest,
      prompt: `${baseRequest.prompt}\n\nYour previous answer did not match the required JSON schema (${lastError instanceof Error && "issues" in lastError ? repairHint(lastError as z.ZodError) : "the answer was not valid JSON"}). Return only JSON that matches the schema.`,
    };
    let raw: unknown;
    try {
      raw = await send(request);
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === "INVALID_JSON" && repair === 0) { lastError = error; continue; }
      await audit(outcomeFor(code), { usage, attempts, errorCode: code });
      throw error;
    }
    const parsed = input.schema.safeParse(raw);
    if (parsed.success) {
      await audit("OK", { usage, attempts });
      return { data: parsed.data, route: { ...route, model }, usage, attempts };
    }
    lastError = parsed.error;
  }
  await audit("INVALID_OUTPUT", { usage, attempts, errorCode: "SCHEMA" });
  throw lastError;
}
