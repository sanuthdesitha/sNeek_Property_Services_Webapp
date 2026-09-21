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
