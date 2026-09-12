// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { GET, POST } from "@/app/api/admin/marketing/ai-compose/route";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), create: vi.fn(), constructor: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.authorize }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: unknown) { mocks.constructor(options); }
    messages = { create: mocks.create };
  },
}));
const post = { caption: "Clean home", hashtags: ["#Clean"], suggestedHook: "Welcome" };
const payload = { platform: "FACEBOOK", topic: "Spring cleaning" };
function request(body = JSON.stringify(payload)) {
  return new NextRequest("http://localhost/api/admin/marketing/ai-compose", { method: "POST", body });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-secret-key");
  vi.stubEnv("ANTHROPIC_MODEL", "");
  delete process.env.ANTHROPIC_MODEL;
  mocks.authorize.mockResolvedValue({ user: { role: Role.ADMIN } });
  mocks.create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(post) }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("AI compose API", () => {
  it.each([Role.ADMIN, Role.OPS_MANAGER])("returns untested configuration for %s without SDK calls", async role => {
    mocks.authorize.mockResolvedValue({ user: { role } });
    vi.stubEnv("ANTHROPIC_MODEL", "test-model");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: "anthropic", model: "test-model", configured: true, connection: "untested" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.authorize).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("reports missing configuration without testing connectivity", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await (await GET()).json()).toEqual({ provider: "anthropic", model: "claude-3-5-sonnet-20241022", configured: false, connection: "untested" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["private auth error test-secret-key", 500]] as const)("handles %s on both methods", async (message, status) => {
    mocks.authorize.mockRejectedValue(new Error(message));
    for (const response of [await GET(), await POST(request("invalid"))]) {
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("test-secret-key");
    }
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it.each(["invalid", "", "null", "{}", JSON.stringify({ ...payload, topic: "x" }), JSON.stringify({ ...payload, platform: "OTHER" })])("returns 400 for invalid input %#", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "   "])("returns actionable 503 for absent provider credentials %#", async key => {
    vi.stubEnv("ANTHROPIC_API_KEY", key ?? "");
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AI composition is not configured. Ask an administrator to configure the provider on the server." });
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("preserves the successful POST shape", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(post);
    expect(mocks.authorize).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });
  it.each([new Error("test-secret-key provider detail"), new Error("UNAUTHORIZED"), new Error("FORBIDDEN"), "secret failure"])("sanitizes provider failures %# as 502", async error => {
    mocks.create.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "AI composition failed. Please try again later." });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each(["not JSON test-secret-key", JSON.stringify({ ...post, caption: "" }), JSON.stringify({ ...post, hashtags: [42] })])("maps malformed output %# to sanitized 502", async text => {
    mocks.create.mockResolvedValue({ content: [{ type: "text", text }] });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "AI composition failed. Please try again later." });
  });
});
