// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { sendEmailDetailed } from "@/lib/notifications/email";
const m = vi.hoisted(() => ({ send: vi.fn(), settings: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: m.send }; } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/email-templates", () => ({ wrapEmailHtml: (_settings: unknown, html: string) => html }));
vi.mock("@/lib/email/suppression", () => ({ isSuppressed: async () => false }));
vi.mock("@/lib/db", () => ({ db: {} }));
const payload = { to: "fixture@example.invalid", subject: "Fixture", html: "<p>Test</p>", critical: true, transactional: true };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("RESEND_API_KEY", "fixture-key"); m.settings.mockResolvedValue({}); });
afterEach(() => vi.unstubAllEnvs());
it("never reports a returned provider error or missing receipt as success", async () => { m.send.mockResolvedValue({ error: { name: "validation_error", message: "Rejected" }, data: null }); expect(await sendEmailDetailed(payload)).toMatchObject({ ok: false, acceptance: "NOT_ACCEPTED", retryable: false }); m.send.mockResolvedValue({ data: null, error: null }); expect(await sendEmailDetailed(payload)).toMatchObject({ ok: false, acceptance: "UNKNOWN" }); });
it("captures confirmed acceptance and limits retries to known rejections", async () => { m.send.mockResolvedValue({ data: { id: "provider-ref" } }); expect(await sendEmailDetailed(payload)).toMatchObject({ ok: true, externalId: "provider-ref", acceptance: "ACCEPTED" }); m.send.mockResolvedValue({ error: { name: "rate_limit_exceeded", message: "Slow down" } }); expect(await sendEmailDetailed(payload)).toMatchObject({ ok: false, acceptance: "NOT_ACCEPTED", retryable: true }); m.send.mockResolvedValue({ error: { name: "internal_server_error", message: "Unknown" } }); expect(await sendEmailDetailed(payload)).toMatchObject({ acceptance: "UNKNOWN" }); });
it("does not retry ambiguous throws but can retry failures before dispatch", async () => { m.send.mockRejectedValue(new Error("timeout")); expect(await sendEmailDetailed(payload)).toMatchObject({ acceptance: "UNKNOWN", retryable: false }); m.settings.mockRejectedValue(new Error("pre-dispatch")); expect(await sendEmailDetailed(payload)).toMatchObject({ acceptance: "NOT_ACCEPTED", retryable: true }); });
it("recognizes missing configuration without a provider call", async () => { vi.stubEnv("RESEND_API_KEY", ""); expect(await sendEmailDetailed(payload)).toMatchObject({ ok: false, acceptance: "NOT_ACCEPTED", retryable: false }); expect(m.send).not.toHaveBeenCalled(); });
