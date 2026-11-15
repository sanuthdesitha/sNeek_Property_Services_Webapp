// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: new Map<string, unknown>(), audit: vi.fn(), lock: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/ssrf", () => ({ assertSafePublicUrl: async (url: string) => new URL(url) }));
vi.mock("@/lib/db", () => {
  const appSetting = {
    findUnique: async ({ where }: { where: { key: string } }) => (m.rows.has(where.key) ? { key: where.key, value: m.rows.get(where.key) } : null),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: unknown } }) => { m.rows.set(where.key, JSON.parse(JSON.stringify(update.value))); return { value: update.value }; },
  };
  const tx = { $executeRaw: m.lock, appSetting, auditLog: { create: m.audit } };
  return { db: { appSetting, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } };
});
import { getPublicCredentialStates, saveAiCredential, saveAiRouting, AiSettingsConflict, AiCloudPhotosConfirmationRequired } from "@/lib/ai/provider/admin";
import { readProviderSecret, AI_CREDENTIALS_KEY } from "@/lib/ai/provider/store";
import { DEFAULT_AI_ROUTING } from "@/lib/ai/provider/routing-schema";

beforeEach(() => {
  m.rows.clear(); vi.clearAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "k".repeat(64));
  vi.stubEnv("ANTHROPIC_API_KEY", "env-anthropic-key-1234");
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("AI provider keys", () => {
  it("uses the environment until a key is saved, then the saved key; removing does not fall back", async () => {
    expect(await readProviderSecret("anthropic")).toBe("env-anthropic-key-1234");
    await saveAiCredential({ provider: "anthropic", apiKey: "sk-saved-anthropic-9876" }, "admin-1");
    expect(await readProviderSecret("anthropic")).toBe("sk-saved-anthropic-9876");
    await saveAiCredential({ provider: "anthropic", clear: true }, "admin-1");
    expect(await readProviderSecret("anthropic")).toBeNull();
  });

  it("stores only ciphertext and shows only the last four characters", async () => {
    await saveAiCredential({ provider: "openai", apiKey: "sk-openai-secret-abcd" }, "admin-1");
    const stored = JSON.stringify(m.rows.get(AI_CREDENTIALS_KEY));
    expect(stored).not.toContain("sk-openai-secret-abcd"); expect(stored).toContain("enc:v1:");
    const states = await getPublicCredentialStates();
    expect(states).toEqual(expect.arrayContaining([
      { provider: "openai", state: "saved", hint: "••••abcd" },
      { provider: "anthropic", state: "environment", hint: "••••1234" },
      { provider: "openai_compatible", state: "missing", hint: null },
    ]));
    expect(JSON.stringify(states)).not.toContain("sk-openai-secret");
  });

  it("audits the provider and action without the key", async () => {
    await saveAiCredential({ provider: "openai", apiKey: "sk-openai-secret-abcd" }, "admin-1");
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "admin-1", action: "AI_PROVIDER_KEY_CHANGED", after: { provider: "openai", action: "saved" } }) });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("sk-openai-secret");
  });

  it("fails closed when the encryption key is gone, and refuses to store a key without one", async () => {
    await saveAiCredential({ provider: "openai", apiKey: "sk-openai-secret-abcd" }, "admin-1");
    vi.stubEnv("ENCRYPTION_KEY", "");
    await expect(readProviderSecret("openai")).rejects.toThrow("could not be decrypted");
    expect((await getPublicCredentialStates()).find((state) => state.provider === "openai")).toMatchObject({ state: "unreadable", hint: null });
    await expect(saveAiCredential({ provider: "anthropic", apiKey: "sk-new" }, "admin-1")).rejects.toThrow();
  });

  it("refuses a plaintext value planted in the stored row", async () => {
    m.rows.set(AI_CREDENTIALS_KEY, { openai: "plaintext-key" });
    await expect(readProviderSecret("openai")).rejects.toThrow("could not be decrypted");
  });
});

describe("AI routing saves", () => {
  const settings = (() => { const { revision: _r, ...rest } = DEFAULT_AI_ROUTING; return rest; })();
  it("increments the revision, audits before and after, and refuses a stale revision with the current value", async () => {
    const saved = await saveAiRouting({ expectedRevision: 0, settings: { ...settings, defaultRoute: { provider: "ollama", model: "llama3.2:3b" } } }, "admin-1");
    expect(saved.revision).toBe(1);
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "AI_SETTINGS_UPDATED", before: expect.objectContaining({ revision: 0 }), after: expect.objectContaining({ revision: 1 }) }) });
    const stale = saveAiRouting({ expectedRevision: 0, settings }, "admin-2");
    await expect(stale).rejects.toBeInstanceOf(AiSettingsConflict);
    await expect(stale).rejects.toMatchObject({ current: expect.objectContaining({ revision: 1, defaultRoute: { provider: "ollama", model: "llama3.2:3b" } }) });
  });
  it("rejects unknown fields, invalid limits and non-https compatible endpoints", async () => {
    await expect(saveAiRouting({ expectedRevision: 0, settings: { ...settings, extra: true } }, "admin-1")).rejects.toThrow();
    await expect(saveAiRouting({ expectedRevision: 0, settings: { ...settings, features: { ...settings.features, wording: { ...settings.features.wording, hourlyLimitPerActor: 0 } } } }, "admin-1")).rejects.toThrow();
    await expect(saveAiRouting({ expectedRevision: 0, settings: { ...settings, compatible: { baseUrl: "http://example.com/v1", label: "" } } }, "admin-1")).rejects.toThrow();
    expect(m.rows.size).toBe(0);
  });
  // Owner decision 2026-11-14: turning cloud photo sending on is saved only
  // for features the route confirmed with the administrator's own PIN.
  it("refuses an unconfirmed cloud photo switch, saves a confirmed one with its own audit row, and turning it off needs nothing", async () => {
    const photosOn = { ...settings, features: { ...settings.features, photo_assign: { ...settings.features.photo_assign, allowCloudImages: true } } };
    const refused = saveAiRouting({ expectedRevision: 0, settings: photosOn }, "admin-1");
    await expect(refused).rejects.toBeInstanceOf(AiCloudPhotosConfirmationRequired);
    await expect(refused).rejects.toMatchObject({ features: ["photo_assign"] });
    expect(m.rows.size).toBe(0);
    expect(m.audit).not.toHaveBeenCalled();
    const saved = await saveAiRouting({ expectedRevision: 0, settings: photosOn }, "admin-1", { cloudPhotosConfirmed: ["photo_assign"] });
    expect(saved.features.photo_assign.allowCloudImages).toBe(true);
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "admin-1", action: "AI_CLOUD_PHOTOS_ALLOWED", after: expect.objectContaining({ features: ["photo_assign"], revision: 1 }) }) });
    m.audit.mockClear();
    const off = await saveAiRouting({ expectedRevision: 1, settings }, "admin-1");
    expect(off.features.photo_assign.allowCloudImages).toBe(false);
    expect(m.audit.mock.calls.map((call) => call[0].data.action)).toEqual(["AI_SETTINGS_UPDATED"]);
  });
});
