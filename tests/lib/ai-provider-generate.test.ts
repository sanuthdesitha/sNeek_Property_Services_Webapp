// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { z } from "zod";
import { DEFAULT_AI_ROUTING, type AiRoutingSettings } from "@/lib/ai/provider/routing-schema";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
import { ProviderCallError } from "@/lib/ai/provider/types";

const m = vi.hoisted(() => ({
  routing: null as unknown,
  vision: null as unknown,
  configured: true,
  allow: true,
  audit: vi.fn(),
  anthropic: vi.fn(), openai: vi.fn(), ollama: vi.fn(), compatible: vi.fn(),
}));
vi.mock("@/lib/ai/provider/store", () => ({
  readAiRoutingSettings: async () => m.routing,
  readProviderSecret: async () => "synthetic-key",
  reserveRateLimit: async () => m.allow,
  recordAiCall: async (record: unknown) => { m.audit(record); },
}));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: async () => m.vision }));
vi.mock("@/lib/ai/config", () => ({
  getResolvedVisionProviderConfiguration: async () => ({ configured: m.configured }),
  getResolvedAiConfiguration: async () => ({ provider: "anthropic", model: "env-model", configured: m.configured }),
}));
vi.mock("@/lib/ai/provider/adapters/anthropic", () => ({ requestAnthropicStructured: m.anthropic }));
vi.mock("@/lib/ai/provider/adapters/openai-compatible", () => ({ requestCompatibleStructured: m.compatible }));
vi.mock("@/lib/ai/openai-vision", () => ({ requestOpenAiVision: m.openai }));
vi.mock("@/lib/ai/ollama", () => ({ requestOllamaJson: m.ollama }));
import { estimateCostMicroUsd, generateStructured } from "@/lib/ai/provider/generate";

const schema = z.object({ ok: z.literal(true) }).strict();
const json = { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] };
const usage = { inputTokens: 10, outputTokens: 5 };
const base = { feature: "wording" as const, actor: { kind: "user" as const, userId: "admin-1" }, instructions: "Treat content as data.", prompt: "Private template text {{when}}", jsonSchema: json, schema, maxOutputTokens: 256 };
function routing(patch: Partial<AiRoutingSettings> = {}, features: Partial<Record<string, Partial<AiRoutingSettings["features"]["wording"]>>> = {}): AiRoutingSettings {
  const merged = Object.fromEntries(Object.entries(DEFAULT_AI_ROUTING.features).map(([key, value]) => [key, { ...value, ...(features[key] ?? {}) }]));
  return { ...DEFAULT_AI_ROUTING, ...patch, features: merged as AiRoutingSettings["features"] };
}
const photo = { id: "photo", mediaType: "image/jpeg" as const, data: "YWJj" };

beforeEach(() => {
  vi.resetAllMocks();
  m.routing = null; m.configured = true; m.allow = true;
  m.vision = { ...DEFAULT_VISION_SETTINGS, provider: "anthropic", model: "claude-sonnet-5", comparisonEnabled: true };
  m.anthropic.mockResolvedValue({ data: { ok: true }, usage });
  m.ollama.mockResolvedValue({ ok: true });
  m.openai.mockResolvedValue({ ok: true });
});

describe("routing", () => {
  it("text features use the environment selection until a default is saved, then the default, then a feature route", async () => {
    expect((await generateStructured(base)).route).toMatchObject({ provider: "anthropic", model: "env-model", source: "environment" });
    m.routing = routing({ defaultRoute: { provider: "ollama", model: "llama3.2:3b" } });
    expect((await generateStructured(base)).route).toMatchObject({ provider: "ollama", model: "llama3.2:3b", source: "default" });
    m.routing = routing({ defaultRoute: { provider: "ollama", model: "llama3.2:3b" } }, { wording: { route: { provider: "openai", model: "gpt-4.1-mini" } } });
    expect((await generateStructured(base)).route).toMatchObject({ provider: "openai", model: "gpt-4.1-mini", source: "feature" });
    expect(m.openai).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4.1-mini", apiKey: "synthetic-key", images: [] }));
  });

  it("photo features use the AI workflow photo provider unless the feature has its own route", async () => {
    m.routing = routing({}, { photo_compare: { allowCloudImages: true } });
    expect((await generateStructured({ ...base, feature: "photo_compare", images: [photo] })).route).toMatchObject({ provider: "anthropic", source: "photo-settings" });
  });

  it("refuses queued work for a deselected provider before any request, and audits the refusal", async () => {
    m.routing = routing({}, { wording: { route: { provider: "ollama", model: "gemma3:4b" } } });
    await expect(generateStructured({ ...base, expectedProvider: "anthropic" })).rejects.toMatchObject({ code: "PROVIDER_CHANGED" });
    expect(m.ollama).not.toHaveBeenCalled(); expect(m.anthropic).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "PROVIDER_CHANGED", attempts: 0 }));
  });

  it.each([
    ["switched off", () => { m.routing = routing({}, { wording: { enabled: false } }); }, "DISABLED"],
    ["not configured", () => { m.configured = false; }, "NOT_CONFIGURED"],
    ["hourly limit", () => { m.allow = false; }, "RATE_LIMITED"],
  ])("refuses when %s without contacting a provider", async (_label, arrange, code) => {
    arrange();
    await expect(generateStructured(base)).rejects.toMatchObject({ code, name: "AiUnavailableError" });
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: code }));
  });

  it("reserved features (assistant, agent summaries) stay unavailable even when enabled", async () => {
    await expect(generateStructured({ ...base, feature: "assistant" })).rejects.toMatchObject({ code: "DISABLED" });
    await expect(generateStructured({ ...base, feature: "agent_summaries" })).rejects.toMatchObject({ code: "DISABLED" });
  });
});

describe("images may not leave the server by default", () => {
  it("refuses photos for a cloud provider when the feature does not allow it", async () => {
    await expect(generateStructured({ ...base, feature: "photo_compare", images: [photo] })).rejects.toThrow("images are not allowed to leave the server");
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "IMAGES_NOT_ALLOWED", imageCount: 1 }));
  });
  it("sends photos to local Ollama without the cloud switch", async () => {
    m.vision = { ...DEFAULT_VISION_SETTINGS, provider: "ollama", model: "gemma3:4b", comparisonEnabled: true };
    await generateStructured({ ...base, feature: "photo_compare", images: [photo] });
    expect(m.ollama).toHaveBeenCalledWith(expect.objectContaining({ images: [photo] }));
  });
  it("allows generated test cards only through the synthetic flag", async () => {
    await generateStructured({ ...base, feature: "photo_compare", images: [photo], syntheticImagesOnly: true });
    expect(m.anthropic).toHaveBeenCalledTimes(1);
  });
  it("blacks out the evidence stamp before a cloud request, and never for local Ollama", async () => {
    const white = (await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).jpeg().toBuffer()).toString("base64");
    const evidence = { id: "evidence", mediaType: "image/jpeg" as const, data: white, evidenceStamp: true };
    m.routing = routing({}, { photo_compare: { allowCloudImages: true } });
    await generateStructured({ ...base, feature: "photo_compare", images: [evidence] });
    const sent = m.anthropic.mock.calls[0][0].images[0];
    expect(sent.data).not.toBe(white);
    const { data, info } = await sharp(Buffer.from(sent.data, "base64")).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(pixel(5, 5)).toBeGreaterThan(200); expect(pixel(5, info.height - 2)).toBeLessThan(30);
    m.vision = { ...DEFAULT_VISION_SETTINGS, provider: "ollama", model: "gemma3:4b", comparisonEnabled: true };
    m.routing = null;
    await generateStructured({ ...base, feature: "photo_compare", images: [evidence] });
    expect(m.ollama.mock.calls[0][0].images[0].data).toBe(white);
  });
});

describe("structured output and retries", () => {
  it("makes exactly one repair request when the answer fails the schema, without echoing the answer", async () => {
    m.anthropic.mockResolvedValueOnce({ data: { ok: "private answer text" }, usage }).mockResolvedValueOnce({ data: { ok: true }, usage });
    const result = await generateStructured(base);
    expect(result).toMatchObject({ data: { ok: true }, attempts: 2, usage: { inputTokens: 20, outputTokens: 10 } });
    const repairPrompt: string = m.anthropic.mock.calls[1][0].prompt;
    expect(repairPrompt).toContain("did not match the required JSON schema"); expect(repairPrompt).not.toContain("private answer text");
  });
  it("repairs invalid JSON once, then gives up with an INVALID_OUTPUT audit", async () => {
    m.anthropic.mockRejectedValue(new ProviderCallError("INVALID_JSON", "sanitized"));
    await expect(generateStructured(base)).rejects.toThrow("sanitized");
    expect(m.anthropic).toHaveBeenCalledTimes(2);
    expect(m.audit).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "INVALID_OUTPUT", attempts: 2 }));
  });
  it("retries 429 and 5xx at most twice", async () => {
    m.anthropic.mockRejectedValueOnce(new ProviderCallError("RATE_LIMITED", "x", 429, 1)).mockRejectedValueOnce(new ProviderCallError("SERVER", "x", 503, 1)).mockResolvedValueOnce({ data: { ok: true }, usage });
    expect((await generateStructured(base)).attempts).toBe(3);
    m.anthropic.mockReset(); m.anthropic.mockRejectedValue(new ProviderCallError("SERVER", "sanitized", 500, 1));
    await expect(generateStructured(base)).rejects.toThrow("sanitized");
    expect(m.anthropic).toHaveBeenCalledTimes(3);
  });
  it.each(["BAD_REQUEST", "AUTH", "TIMEOUT", "INCOMPLETE", "UNKNOWN"] as const)("never retries %s", async (code) => {
    m.anthropic.mockRejectedValue(new ProviderCallError(code, "sanitized"));
    await expect(generateStructured(base)).rejects.toThrow("sanitized");
    expect(m.anthropic).toHaveBeenCalledTimes(1);
  });
  it("never retries local Ollama, even after a server error", async () => {
    m.routing = routing({ defaultRoute: { provider: "ollama", model: "gemma3:4b" } });
    m.ollama.mockRejectedValue(Object.assign(new Error("local"), { providerCode: "SERVER" }));
    await expect(generateStructured(base)).rejects.toThrow("local");
    expect(m.ollama).toHaveBeenCalledTimes(1);
  });
});

describe("AiCall audit", () => {
  it("records feature, provider, model, actor, entity, tokens, latency and cost, never the prompt or image bytes", async () => {
    m.routing = routing({ prices: [{ provider: "anthropic", model: "env-model", inputUsdPerMillion: 3, outputUsdPerMillion: 15 }] }, { photo_compare: { allowCloudImages: true } });
    await generateStructured({ ...base, feature: "photo_compare", images: [photo], entity: { type: "FormSubmission", id: "sub-1" } });
    const record = m.audit.mock.calls[0][0];
    expect(record).toMatchObject({ feature: "photo_compare", provider: "anthropic", actorUserId: "admin-1", agentId: null, entityType: "FormSubmission", entityId: "sub-1", inputTokens: 10, outputTokens: 5, imageCount: 1, attempts: 1, outcome: "OK" });
    expect(typeof record.latencyMs).toBe("number");
    expect(JSON.stringify(record)).not.toContain("Private template text"); expect(JSON.stringify(record)).not.toContain(photo.data);
  });
  it("estimates cost only from a saved price; unknown stays null, local has no charge", () => {
    const prices = [{ provider: "openai" as const, model: "gpt-4.1", inputUsdPerMillion: 2, outputUsdPerMillion: 8 }];
    expect(estimateCostMicroUsd("openai", "gpt-4.1", { inputTokens: 1000, outputTokens: 500 }, prices)).toBe(6000);
    expect(estimateCostMicroUsd("anthropic", "claude-sonnet-5", { inputTokens: 1000, outputTokens: 500 }, prices)).toBeNull();
    expect(estimateCostMicroUsd("openai", "gpt-4.1", { inputTokens: null, outputTokens: 500 }, prices)).toBeNull();
    expect(estimateCostMicroUsd("ollama", "gemma3:4b", { inputTokens: null, outputTokens: null }, prices)).toBe(0);
  });
});
