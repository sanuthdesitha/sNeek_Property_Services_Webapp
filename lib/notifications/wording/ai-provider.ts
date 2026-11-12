import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getResolvedAiConfiguration } from "@/lib/ai/config";
import { requestOllamaJson } from "@/lib/ai/ollama";
import { requestOpenAiVision } from "@/lib/ai/openai-vision";

/**
 * The text provider for "Regenerate wording": the app's existing AI
 * configuration (Settings, AI; the same selection the social post composer
 * uses). No other provider is tried when the selected one is not configured.
 */
export type ProviderAvailability = { available: boolean; reason: string | null };

export async function wordingProviderAvailability(): Promise<ProviderAvailability> {
  try {
    const config = await getResolvedAiConfiguration();
    if (!config.configured) return { available: false, reason: "No AI text provider is configured (Settings, AI). Wording can still be edited by hand." };
    return { available: true, reason: null };
  } catch {
    return { available: false, reason: "The AI provider settings could not be read." };
  }
}

/** Sends one prompt and returns the parsed JSON object. Throws on any provider failure. */
export async function requestWordingJson(input: { prompt: string; instructions: string; schema: Record<string, unknown> }): Promise<unknown> {
  const config = await getResolvedAiConfiguration();
  if (!config.configured) throw new Error("No AI text provider is configured.");
  if (config.provider === "openai" || config.provider === "ollama") {
    const adapter = config.provider === "openai" ? requestOpenAiVision : requestOllamaJson;
    return adapter({ model: config.model, prompt: input.prompt, instructions: input.instructions, images: [], schema: input.schema });
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), timeout: 30000, maxRetries: 0 });
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 2048,
    system: input.instructions,
    messages: [{ role: "user", content: input.prompt }],
  });
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  return JSON.parse(cleaned);
}
