import { afterEach, expect, it, vi } from "vitest";
import { getVisionProviderConfiguration, getAiConfiguration } from "@/lib/ai/config";
afterEach(() => vi.unstubAllEnvs());
it("keeps provider credentials isolated and never returns keys", () => {
  vi.stubEnv("OPENAI_API_KEY", "openai-secret"); vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("OPENAI_VISION_MODEL", "");
  expect(getVisionProviderConfiguration("openai")).toEqual({ provider: "openai", configured: true, model: "gpt-4.1" });
  expect(getVisionProviderConfiguration("anthropic").configured).toBe(false);
  expect(getAiConfiguration().provider).toBe("anthropic");
  expect(JSON.stringify(getVisionProviderConfiguration("openai"))).not.toContain("secret");
});
it("supports an explicit server vision model while treating blank credentials as absent", () => {
  vi.stubEnv("OPENAI_VISION_MODEL", " gpt-4.1-2025-04-14 "); vi.stubEnv("OPENAI_API_KEY", "   ");
  expect(getVisionProviderConfiguration("openai")).toMatchObject({ model: "gpt-4.1-2025-04-14", configured: false });
});

it("selects local text and vision without cloud credentials", () => {
  vi.stubEnv("AI_TEXT_PROVIDER", "ollama"); vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434");
  vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OLLAMA_TEXT_MODEL", "llama3.2:3b");
  expect(getAiConfiguration()).toEqual({ provider: "ollama", configured: true, model: "llama3.2:3b" });
  expect(getVisionProviderConfiguration("ollama")).toMatchObject({ configured: true, model: "gemma3:4b" });
});
it("does not silently enable a paid provider for invalid text configuration", () => {
  vi.stubEnv("AI_TEXT_PROVIDER", "olama"); vi.stubEnv("ANTHROPIC_API_KEY", "cloud-key");
  expect(getAiConfiguration().configured).toBe(false);
});
