import { beforeEach, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
const mocks = vi.hoisted(() => ({ role: vi.fn(), get: vi.fn(), save: vi.fn(), check: vi.fn(), config: vi.fn(), recognition: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: mocks.get, saveVisionSettings: mocks.save }));
vi.mock("@/lib/ai/vision", () => ({ checkVisionConnection: mocks.check }));
vi.mock("@/lib/ai/config", () => ({ getVisionProviderConfiguration: mocks.config }));
vi.mock("@/lib/ai/property-photo-model", () => ({ getRecognitionConfiguration: mocks.recognition }));
import { GET, PATCH } from "@/app/api/admin/ai/vision/route";
import { POST } from "@/app/api/admin/ai/vision/check/route";
beforeEach(() => { vi.clearAllMocks(); mocks.role.mockResolvedValue({}); mocks.get.mockResolvedValue(DEFAULT_VISION_SETTINGS); mocks.save.mockImplementation(async value => value); mocks.config.mockReturnValue({ configured: true }); mocks.recognition.mockReturnValue({ configured: false }); });
const request = (data: unknown) => new Request("http://local/api/admin/ai/vision", { method: "PATCH", body: JSON.stringify(data) });
it("ops can read public settings without checking provider", async () => {
  const response = await GET(); expect(response.status).toBe(200);
  expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  expect(await response.json()).toEqual({ settings: DEFAULT_VISION_SETTINGS, configured: true, recognitionConfigured: false });
  expect(mocks.check).not.toHaveBeenCalled();
});
it("admin writes valid settings", async () => {
  expect((await PATCH(request(DEFAULT_VISION_SETTINGS))).status).toBe(200);
  expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN]); expect(mocks.save).toHaveBeenCalledWith(DEFAULT_VISION_SETTINGS);
});
it.each([{ batchSize: 9 }, { minConfidence: -1 }, { maxScoreContribution: 21 }, { scoreMode: "automatic" }, { apiKey: "secret" }])("rejects invalid settings %o", async delta => {
  expect((await PATCH(request({ ...DEFAULT_VISION_SETTINGS, ...delta }))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
});
it("requires credential before enabling", async () => {
  mocks.config.mockReturnValue({ configured: false });
  expect((await PATCH(request({ ...DEFAULT_VISION_SETTINGS, comparisonEnabled: true }))).status).toBe(400);
});
it("requires the selected provider's key, not another configured provider", async () => {
  mocks.config.mockImplementation(provider => ({ configured: provider === "anthropic" }));
  const response = await PATCH(request({ ...DEFAULT_VISION_SETTINGS, provider: "openai", comparisonEnabled: true }));
  expect(response.status).toBe(400); expect((await response.json()).error).toContain("OPENAI_API_KEY"); expect(mocks.save).not.toHaveBeenCalled();
});
it("requires dedicated service credentials but supports recognition without an Anthropic key", async () => {
  mocks.config.mockReturnValue({ configured: false });
  const input = { ...DEFAULT_VISION_SETTINGS, dedicatedRecognitionEnabled: true, assignmentEnabled: true };
  expect((await PATCH(request(input))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
  mocks.recognition.mockReturnValue({ configured: true });
  expect((await PATCH(request(input))).status).toBe(200);
});
it("denies writes and checks before side effects", async () => {
  mocks.role.mockRejectedValue(new Error("FORBIDDEN"));
  expect((await PATCH(request(DEFAULT_VISION_SETTINGS))).status).toBe(403);
  expect((await POST()).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled();
});
it("does not expose provider errors", async () => {
  mocks.check.mockRejectedValue(new Error("secret-key-provider-body"));
  const response = await POST(); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret-key");
});

it("accepts tagged local models and requires a local endpoint to enable them", async () => {
  const settings = { ...DEFAULT_VISION_SETTINGS, provider: "ollama", model: "gemma3:4b", comparisonEnabled: true };
  mocks.config.mockImplementation(provider => ({ configured: provider !== "ollama" }));
  const rejected = await PATCH(request(settings));
  expect(rejected.status).toBe(400); expect((await rejected.json()).error).toContain("OLLAMA_BASE_URL");
  mocks.config.mockReturnValue({ configured: true });
  expect((await PATCH(request(settings))).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith(settings);
});
