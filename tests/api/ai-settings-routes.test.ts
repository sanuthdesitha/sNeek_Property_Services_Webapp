// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
const m = vi.hoisted(() => ({
  session: vi.fn(), user: vi.fn(), saveCredential: vi.fn(), saveRouting: vi.fn(), credentials: vi.fn(), rate: vi.fn(),
  routing: vi.fn(), resolve: vi.fn(), usage: vi.fn(), queue: vi.fn(), read: vi.fn(), verify: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/ai/provider/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider/admin")>("@/lib/ai/provider/admin");
  return { AiSettingsConflict: actual.AiSettingsConflict, AiCloudPhotosConfirmationRequired: actual.AiCloudPhotosConfirmationRequired, saveAiCredential: m.saveCredential, saveAiRouting: m.saveRouting, getPublicCredentialStates: m.credentials };
});
// Tier C since 2026-11-14: the route confirms with the shared own-PIN check.
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/ai/provider/store", () => ({ reserveRateLimit: m.rate, SECRET_PROVIDERS: ["anthropic", "openai", "openai_compatible"] }));
vi.mock("@/lib/ai/provider/routing", () => ({ getAiRouting: m.routing, resolveFeatureRoute: m.resolve }));
vi.mock("@/lib/ai/provider/usage", () => ({ getMonthlyAiUsage: m.usage }));
vi.mock("@/lib/ai/provider/tasks", () => ({ queueFeatureTest: m.queue, readAiTask: m.read }));
import { POST as saveKey } from "@/app/api/admin/ai/credentials/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/admin/ai/settings/route";
import { POST as queueTest } from "@/app/api/admin/ai/tests/route";
import { GET as readTest } from "@/app/api/admin/ai/tests/[id]/route";
import { AiSettingsConflict } from "@/lib/ai/provider/admin";
import { DEFAULT_AI_ROUTING } from "@/lib/ai/provider/routing-schema";

const admin = { user: { id: "admin-1", role: "ADMIN" } };
const post = (body: unknown) => new Request("http://local/api", { method: "POST", body: JSON.stringify(body) });
const put = (body: unknown) => new Request("http://local/api", { method: "PUT", body: JSON.stringify(body) });
let hash: string;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "k".repeat(64));
  hash ??= await bcrypt.hash("correct horse", 4);
  m.session.mockResolvedValue(admin); m.user.mockResolvedValue({ passwordHash: hash }); m.rate.mockResolvedValue(true);
  m.verify.mockResolvedValue(true);
  m.credentials.mockResolvedValue([]); m.routing.mockResolvedValue(DEFAULT_AI_ROUTING); m.usage.mockResolvedValue(null);
  m.resolve.mockImplementation(async (feature: string) => ({ feature, provider: "ollama", model: "gemma3:4b", configured: true, enabled: true, cloud: false, allowImages: true, source: "photo-settings" }));
});

describe("POST /api/admin/ai/credentials", () => {
  // Changed 2026-11-14 (simpler confirmations): the key is confirmed with the
  // administrator's own PIN (password only while they have no PIN) through
  // verifySensitiveAction, instead of a bcrypt check of the password here.
  it("saves only after the administrator's own PIN is verified, and never echoes the key", async () => {
    m.credentials.mockResolvedValue([{ provider: "openai", state: "saved", hint: "••••abcd" }]);
    const response = await saveKey(post({ provider: "openai", apiKey: "sk-secret-abcd", security: { pin: "4826" } }));
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "4826" });
    expect(m.saveCredential).toHaveBeenCalledWith({ provider: "openai", apiKey: "sk-secret-abcd", clear: undefined }, "admin-1");
    expect(await response.text()).not.toContain("sk-secret");
  });
  it("reads an older screen's top-level password as the password credential (accepted only while there is no PIN)", async () => {
    expect((await saveKey(post({ provider: "openai", clear: true, password: "correct horse" }))).status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { password: "correct horse" });
  });
  it("refuses a wrong PIN, or a password from someone who has a PIN, without saving", async () => {
    const { SensitiveVerificationError } = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    const wrong = await saveKey(post({ provider: "openai", apiKey: "sk-secret-abcd", security: { pin: "0000" } }));
    expect(wrong.status).toBe(423);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_SECURITY_VERIFICATION", needsCredential: true });
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("PIN_REQUIRED"));
    const password = await saveKey(post({ provider: "openai", apiKey: "sk-secret-abcd", security: { password: "correct horse" } }));
    expect(password.status).toBe(423);
    expect((await password.json()).code).toBe("PIN_REQUIRED");
    expect(m.saveCredential).not.toHaveBeenCalled();
  });
  it("refuses while testing as someone, for non-administrators, and after too many attempts", async () => {
    m.session.mockResolvedValueOnce({ ...admin, impersonation: { actorId: "admin-1", mode: "FULL" } });
    expect((await saveKey(post({ provider: "openai", apiKey: "k", password: "correct horse" }))).status).toBe(403);
    m.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await saveKey(post({ provider: "openai", apiKey: "k", password: "correct horse" }))).status).toBe(403);
    m.rate.mockResolvedValueOnce(false);
    expect((await saveKey(post({ provider: "openai", apiKey: "k", password: "correct horse" }))).status).toBe(429);
    expect(m.saveCredential).not.toHaveBeenCalled();
    expect(m.verify).not.toHaveBeenCalled();
  });
  it("refuses to store a key when the server has no ENCRYPTION_KEY", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect((await saveKey(post({ provider: "anthropic", apiKey: "sk-x", password: "correct horse" }))).status).toBe(409);
    expect(m.saveCredential).not.toHaveBeenCalled();
  });
});

describe("/api/admin/ai/settings", () => {
  it("returns routing, key states, resolved routes and usage to administrators", async () => {
    const response = await getSettings();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.routes).toHaveLength(8); expect(body.routing.revision).toBe(0); expect(body.encryptionReady).toBe(true);
  });
  it("returns 409 with the current settings on a stale save", async () => {
    m.saveRouting.mockRejectedValue(new AiSettingsConflict({ ...DEFAULT_AI_ROUTING, revision: 4 }));
    const response = await putSettings(put({ expectedRevision: 3, settings: {} }));
    expect(response.status).toBe(409); expect((await response.json()).current.revision).toBe(4);
  });
  it("refuses saves while testing as someone", async () => {
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1", mode: "FULL" } });
    expect((await putSettings(put({}))).status).toBe(403); expect(m.saveRouting).not.toHaveBeenCalled();
  });
});

// Owner decision 2026-11-14: turning "photos may leave the server" on needs
// the administrator's own PIN (password only while they have no PIN),
// verified in the same request; turning it off and other changes do not.
describe("PUT /api/admin/ai/settings: cloud photo switch", () => {
  const settingsOf = (routing: typeof DEFAULT_AI_ROUTING) => { const { revision: _r, ...rest } = routing; return rest; };
  const withPhotos = (on: boolean) => ({ ...DEFAULT_AI_ROUTING, features: { ...DEFAULT_AI_ROUTING.features, photo_compare: { ...DEFAULT_AI_ROUTING.features.photo_compare, allowCloudImages: on } } });

  it("turning it on verifies the PIN with ai.cloud_photos before saving, and never stores the credential", async () => {
    m.saveRouting.mockResolvedValue(withPhotos(true));
    const response = await putSettings(put({ expectedRevision: 0, settings: settingsOf(withPhotos(true)), security: { pin: "4826" } }));
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "4826" }, "ai.cloud_photos");
    const [saved, actor, options] = m.saveRouting.mock.calls[0];
    expect(saved).not.toHaveProperty("security");
    expect(actor).toBe("admin-1");
    expect(options).toEqual({ cloudPhotosConfirmed: ["photo_compare"] });
  });
  it("a wrong or missing PIN refuses with 423 and saves nothing", async () => {
    const { SensitiveVerificationError } = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    const wrong = await putSettings(put({ expectedRevision: 0, settings: settingsOf(withPhotos(true)), security: { pin: "0000" } }));
    expect(wrong.status).toBe(423);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_SECURITY_VERIFICATION", needsCredential: true, features: ["photo_compare"] });
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("PIN_OR_PASSWORD_REQUIRED"));
    expect((await putSettings(put({ expectedRevision: 0, settings: settingsOf(withPhotos(true)) }))).status).toBe(423);
    expect(m.saveRouting).not.toHaveBeenCalled();
  });
  it("turning it off, or any other change, needs no PIN", async () => {
    m.routing.mockResolvedValue(withPhotos(true));
    m.saveRouting.mockResolvedValue(withPhotos(false));
    expect((await putSettings(put({ expectedRevision: 0, settings: settingsOf(withPhotos(false)) }))).status).toBe(200);
    const limit = { ...withPhotos(true), features: { ...withPhotos(true).features, wording: { ...withPhotos(true).features.wording, hourlyLimitPerActor: 45 } } };
    expect((await putSettings(put({ expectedRevision: 0, settings: settingsOf(limit) }))).status).toBe(200);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.saveRouting.mock.calls.every((call) => JSON.stringify(call[2]) === JSON.stringify({ cloudPhotosConfirmed: [] }))).toBe(true);
  });
  it("is refused while testing as someone, before any PIN check", async () => {
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1", mode: "FULL" } });
    expect((await putSettings(put({ expectedRevision: 0, settings: settingsOf(withPhotos(true)), security: { pin: "4826" } }))).status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.saveRouting).not.toHaveBeenCalled();
  });
  it("answers 423 when the locked save finds an unconfirmed switch (changed underneath)", async () => {
    const { AiCloudPhotosConfirmationRequired } = await import("@/lib/ai/provider/admin");
    m.saveRouting.mockRejectedValue(new AiCloudPhotosConfirmationRequired(["photo_assign"]));
    const response = await putSettings(put({ expectedRevision: 0, settings: settingsOf(DEFAULT_AI_ROUTING) }));
    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ code: "CLOUD_PHOTOS_CONFIRMATION_REQUIRED", needsCredential: true, features: ["photo_assign"] });
  });
});

describe("feature tests", () => {
  it("queues a test for a known feature and reads only the requester's own task", async () => {
    m.queue.mockResolvedValue({ id: "task-1", status: "PENDING" });
    expect((await queueTest(post({ feature: "wording" }))).status).toBe(202);
    expect(m.queue).toHaveBeenCalledWith("wording", "admin-1");
    expect((await queueTest(post({ feature: "anything" }))).status).toBe(400);
    m.read.mockResolvedValue(null);
    expect((await readTest(new Request("http://local"), { params: { id: "task-2" } })).status).toBe(404);
    expect(m.read).toHaveBeenCalledWith("task-2", "admin-1");
  });
});
