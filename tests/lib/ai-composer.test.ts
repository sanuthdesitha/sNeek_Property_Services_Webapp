// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAiConfiguration } from "@/lib/ai/config";
import { composeSocialPost } from "@/lib/marketing/ai-composer";

const mocks = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: unknown) { mocks.constructor(options); }
    messages = { create: mocks.create };
  },
}));
const post = { caption: "A clean start", hashtags: ["#Clean", "#Sydney"], suggestedHook: "Welcome home" };
const request = { platform: "INSTAGRAM" as const, topic: "Spring cleaning" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-secret-key");
  vi.stubEnv("ANTHROPIC_MODEL", "");
  delete process.env.ANTHROPIC_MODEL;
  mocks.create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(post) }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("AI configuration and composer", () => {
  it("exposes only sanitized configuration with the compatible default", () => {
    expect(getAiConfiguration()).toEqual({ provider: "anthropic", model: "claude-3-5-sonnet-20241022", configured: true });
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "   "])("rejects absent credentials (%s) before creating a client", async key => {
    vi.stubEnv("ANTHROPIC_API_KEY", key ?? "");
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    expect(getAiConfiguration().configured).toBe(false);
    await expect(composeSocialPost(request)).rejects.toThrow();
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("preserves successful output and explicitly bounds timeout and retries", async () => {
    expect(await composeSocialPost(request)).toEqual(post);
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-secret-key", timeout: 30000, maxRetries: 0 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-3-5-sonnet-20241022", max_tokens: 1024 }));
  });
  it("reads a model override at call time", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", " custom-model ");
    expect(getAiConfiguration().model).toBe("custom-model");
    await composeSocialPost(request);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: "custom-model" }));
  });
  it("falls back for a whitespace model override", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "  ");
    expect(getAiConfiguration().model).toBe("claude-3-5-sonnet-20241022");
  });
  it("accepts fenced JSON across text blocks and ignores non-text blocks", async () => {
    mocks.create.mockResolvedValue({ content: [
      { type: "thinking", thinking: "ignored" },
      { type: "text", text: "```json\n" },
      { type: "text", text: JSON.stringify(post) + "\n```" },
    ] });
    expect(await composeSocialPost(request)).toEqual(post);
  });
  it.each([
    null, {}, { ...post, caption: " " }, { ...post, caption: 12 },
    { ...post, caption: "x".repeat(10001) }, { ...post, hashtags: "#Clean" },
    { ...post, hashtags: [1] }, { ...post, hashtags: ["clean"] },
    { ...post, hashtags: ["#two words"] }, { ...post, hashtags: ["#"] },
    { ...post, hashtags: ["#" + "x".repeat(100)] },
    { ...post, hashtags: Array(31).fill("#Clean") },
    { ...post, suggestedHook: null }, { ...post, suggestedHook: "x".repeat(1001) },
    { ...post, unexpected: "field" },
  ])("rejects invalid structured output %#", async output => {
    mocks.create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(output) }] });
    await expect(composeSocialPost(request)).rejects.toThrow();
  });
  it.each(["", "not JSON", "Here is your post: " + JSON.stringify(post)])("rejects malformed text %#", async text => {
    mocks.create.mockResolvedValue({ content: [{ type: "text", text }] });
    await expect(composeSocialPost(request)).rejects.toThrow();
  });
  it("allows empty hashtags and hook without inventing fields", async () => {
    const output = { caption: "Post", hashtags: [], suggestedHook: "" };
    mocks.create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(output) }] });
    expect(await composeSocialPost(request)).toEqual(output);
  });
  it("does not retry SDK failures", async () => {
    mocks.create.mockRejectedValue(new Error("provider failure"));
    await expect(composeSocialPost(request)).rejects.toThrow();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
