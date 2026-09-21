// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), openai: vi.fn(), ollama: vi.fn(), anthropic: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ getAiConfiguration: m.config }));
vi.mock("@/lib/ai/openai-vision", () => ({ requestOpenAiVision: m.openai }));
vi.mock("@/lib/ai/ollama", () => ({ requestOllamaJson: m.ollama }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { constructor() { m.anthropic(); } } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "admin", role: "ADMIN" } }) }));
import { GET, POST } from "@/app/api/admin/marketing/ai-compose/route";
import { NextRequest } from "next/server";
import { composeSocialPost } from "@/lib/marketing/ai-composer";
const post = { caption: "Welcome home", hashtags: ["#Sydney"], suggestedHook: "Clean start" };
const request = { platform: "FACEBOOK" as const, topic: "A spring clean" };
beforeEach(() => { vi.resetAllMocks(); m.openai.mockResolvedValue(post); m.ollama.mockResolvedValue(post); });
it.each(["openai", "ollama"])("uses only selected %s structured adapter without images", async provider => {
  m.config.mockReturnValue({ provider, model: "chosen-model", configured: true });
  expect(await composeSocialPost(request)).toEqual(post);
  const selected = provider === "openai" ? m.openai : m.ollama;
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ model: "chosen-model", images: [], schema: expect.objectContaining({ additionalProperties: false }) }));
  expect(selected.mock.calls[0][0].prompt).toContain(request.topic);
  expect(provider === "openai" ? m.ollama : m.openai).not.toHaveBeenCalled(); expect(m.anthropic).not.toHaveBeenCalled();
});
it.each(["openai", "ollama"])("rejects malformed %s output", async provider => {
  m.config.mockReturnValue({ provider, model: "chosen-model", configured: true });
  (provider === "openai" ? m.openai : m.ollama).mockResolvedValue({ ...post, hashtags: ["unsafe nonhashtag"] });
  await expect(composeSocialPost(request)).rejects.toThrow(); expect(m.anthropic).not.toHaveBeenCalled();
});
it("never sends local failures to either cloud provider", async () => {
  m.config.mockReturnValue({ provider: "ollama", model: "gemma3:4b", configured: true }); m.ollama.mockRejectedValue(new Error("Local server unavailable"));
  await expect(composeSocialPost(request)).rejects.toThrow("Local server unavailable"); expect(m.ollama).toHaveBeenCalledTimes(1); expect(m.openai).not.toHaveBeenCalled(); expect(m.anthropic).not.toHaveBeenCalled();
});
it("blocks unknown and unconfigured providers without any request", async () => {
  for (const config of [{ provider: "ollama", configured: false }, { provider: "other", configured: true }]) { m.config.mockReturnValue({ ...config, model: "model" }); await expect(composeSocialPost(request)).rejects.toThrow(); }
  expect(m.openai).not.toHaveBeenCalled(); expect(m.ollama).not.toHaveBeenCalled(); expect(m.anthropic).not.toHaveBeenCalled();
});
it("reports local selection and sanitizes local failure without a cloud request", async () => {
  m.config.mockReturnValue({ provider: "ollama", model: "gemma3:4b", configured: true });
  expect(await (await GET()).json()).toEqual({ provider: "ollama", model: "gemma3:4b", configured: true, connection: "untested" });
  m.ollama.mockRejectedValue(new Error("private local endpoint token"));
  const response = await POST(new NextRequest("http://local/api/admin/marketing/ai-compose", { method: "POST", body: JSON.stringify(request) }));
  expect(response.status).toBe(502); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(await response.json()).toEqual({ error: "AI composition failed. Please try again later." });
  expect(m.openai).not.toHaveBeenCalled(); expect(m.anthropic).not.toHaveBeenCalled();
});
