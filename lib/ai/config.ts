import "server-only";
import { isOllamaConfigured } from "./ollama";

export type AiProvider = "openai" | "anthropic" | "ollama";
export function getVisionProviderConfiguration(provider: AiProvider) {
  if (provider === "ollama") return { provider, model: process.env.OLLAMA_VISION_MODEL?.trim() || "gemma3:4b", configured: isOllamaConfigured() };
  return provider === "openai"
    ? { provider, model: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4.1", configured: Boolean(process.env.OPENAI_API_KEY?.trim()) }
    : { provider, model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5", configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) };
}

export function getAiConfiguration(): { provider: AiProvider; model: string; configured: boolean } {
  const requested = process.env.AI_TEXT_PROVIDER?.trim() || "anthropic";
  const provider: AiProvider = requested === "openai" || requested === "ollama" ? requested : "anthropic";
  const config = getVisionProviderConfiguration(provider);
  return { ...config,
    model: provider === "ollama" ? process.env.OLLAMA_TEXT_MODEL?.trim() || "gemma3:4b" : provider === "openai" ? process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1" : config.model,
    configured: ["openai", "anthropic", "ollama"].includes(requested) && config.configured,
  };
}

/** Resolved runtime settings. Sync exports above remain env-only for older callers. */
export async function getResolvedVisionProviderConfiguration(provider: AiProvider) {
  if (provider !== "ollama") return getVisionProviderConfiguration(provider);
  const { getOllamaSettings } = await import("./ollama-settings");
  const { validateOllamaBaseUrl } = await import("./ollama-settings-schema");
  const settings = await getOllamaSettings();
  return { provider, model: settings.visionModel, configured: validateOllamaBaseUrl(settings.baseUrl) };
}
export async function getResolvedAiConfiguration(): Promise<{provider: AiProvider;model:string;configured:boolean}> {
  const { getOllamaSettings, getPublicOllamaSettings } = await import("./ollama-settings");
  const { validateOllamaBaseUrl } = await import("./ollama-settings-schema");
  const selection = await getPublicOllamaSettings();
  const settings = selection.useForText ? await getOllamaSettings() : selection;
  if (settings.useForText) return {provider:"ollama",model:settings.textModel,configured:validateOllamaBaseUrl(settings.baseUrl)};
  const fallback = getAiConfiguration();
  // An explicit saved false disables an old environment Ollama selection.
  return fallback.provider === "ollama" ? { ...fallback, configured: false } : fallback;
}
