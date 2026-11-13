/**
 * Test double for `@/lib/ai/provider/store` (the AI layer's database seam).
 * Use inside a vi.mock factory:
 *   vi.mock("@/lib/ai/provider/store", async () => (await import("../helpers/ai-provider-store-mock")).aiStoreMock({ allowCloudImages: true }));
 * Plain functions (not vi.fn) so vi.resetAllMocks() in a test cannot turn them off.
 * Keys come from the (stubbed) environment, as before a key is saved in Settings.
 */
import { DEFAULT_AI_ROUTING, type AiRoutingSettings } from "@/lib/ai/provider/routing-schema";

export function aiStoreMock(options: { allowCloudImages?: boolean; routing?: AiRoutingSettings | null } = {}) {
  const features = Object.fromEntries(Object.entries(DEFAULT_AI_ROUTING.features).map(([key, value]) => [key, { ...value, allowCloudImages: options.allowCloudImages ?? false }]));
  const routing = options.routing === undefined ? { ...DEFAULT_AI_ROUTING, features } as AiRoutingSettings : options.routing;
  const envKeys: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openai_compatible: "OPENAI_COMPATIBLE_API_KEY" };
  return {
    AI_ROUTING_KEY: "ai_routing_v1",
    AI_CREDENTIALS_KEY: "ai_provider_credentials_v1",
    SECRET_PROVIDERS: ["anthropic", "openai", "openai_compatible"],
    readAiRoutingSettings: async () => routing,
    readStoredCredentials: async () => null,
    readProviderSecret: async (provider: string) => process.env[envKeys[provider]]?.trim() || null,
    environmentSecret: (provider: string) => process.env[envKeys[provider]]?.trim() || null,
    reserveRateLimit: async () => true,
    recordAiCall: async () => undefined,
  };
}
