import "server-only";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/provider/generate";
import { resolveFeatureRoute } from "@/lib/ai/provider/routing";
import type { AiActor } from "@/lib/ai/provider/types";

/**
 * The text provider for "Regenerate wording": the "wording" feature of the
 * shared AI provider layer (Settings, AI: its own route, else the default,
 * else the server environment selection). No other provider is tried when the
 * selected one is not configured.
 */
export type ProviderAvailability = { available: boolean; reason: string | null };

export async function wordingProviderAvailability(): Promise<ProviderAvailability> {
  try {
    const route = await resolveFeatureRoute("wording");
    if (!route.enabled) return { available: false, reason: "AI wording suggestions are switched off (Settings, AI). Wording can still be edited by hand." };
    if (!route.configured) return { available: false, reason: "No AI text provider is configured (Settings, AI). Wording can still be edited by hand." };
    return { available: true, reason: null };
  } catch {
    return { available: false, reason: "The AI provider settings could not be read." };
  }
}

/**
 * Sends one prompt and returns the parsed JSON object. Throws on any provider
 * failure. The caller (regenerate.ts) validates variables and required parts;
 * here the answer only has to be a JSON object, with one repair request if not.
 */
export async function requestWordingJson(input: { prompt: string; instructions: string; schema: Record<string, unknown>; actor?: AiActor }): Promise<unknown> {
  const result = await generateStructured({
    feature: "wording",
    actor: input.actor ?? { kind: "system", label: "notification-wording" },
    instructions: input.instructions,
    prompt: input.prompt,
    jsonSchema: input.schema,
    schema: z.record(z.unknown()),
    maxOutputTokens: 2048,
  });
  return result.data;
}
