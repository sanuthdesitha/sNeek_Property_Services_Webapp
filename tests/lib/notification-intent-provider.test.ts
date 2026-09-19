// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { deliverProviderIntent } from "@/lib/notifications/intent-provider";
import { notificationEnvelopeSchema } from "@/lib/notifications/intent-contract";
const m = vi.hoisted(() => ({ user: vi.fn(), subscription: vi.fn(), remove: vi.fn(), preference: vi.fn(), eventPreference: vi.fn(), settings: vi.fn(), email: vi.fn(), sms: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, notificationPreference: { findUnique: m.eventPreference }, pushSubscription: { findFirst: m.subscription, deleteMany: m.remove } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.preference }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPush: m.push }));
const envelope = (transport = "EMAIL") => notificationEnvelopeSchema.parse({ version: 1, eventId: "receipt", eventKey: "test.event", entity: { type: "Job", id: "job" }, actorId: "actor", recipient: { userId: "admin", role: "ADMIN", scope: { kind: "ADMIN_OPERATIONS" } }, severity: "CRITICAL", category: "jobs", transport, subject: "Test", body: "<private>\ntext", jobId: "job", ...(transport === "WEB_PUSH" ? { subscriptionId: "device" } : {}) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "EMAIL,SMS,WEB_PUSH"); m.user.mockResolvedValue({ id: "admin", role: "ADMIN", isActive: true, email: "fixture@example.invalid", phone: "+61400000000" }); m.preference.mockResolvedValue(true); m.settings.mockResolvedValue({}); m.email.mockResolvedValue({ ok: true, externalId: "provider-ref" }); m.sms.mockResolvedValue({ ok: true, status: "sent" }); m.push.mockResolvedValue({ ok: true }); m.subscription.mockResolvedValue({ id: "device", userId: "admin", endpoint: "https://push.invalid/fixture", p256dh: "key", auth: "auth" }); });
afterEach(() => vi.unstubAllEnvs());
it("external providers default disabled", async () => { vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", ""); expect(await deliverProviderIntent(envelope())).toEqual({ kind: "SKIPPED", errorCode: "transport_not_enabled" }); expect(m.user).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled(); });
it("honors current recipient scope, category, active status and preference even for critical events", async () => {
  expect(await deliverProviderIntent({ ...envelope(), recipient: { ...envelope().recipient, scope: { kind: "ENTITY", type: "Job", id: "job" } } })).toMatchObject({ kind: "SKIPPED" });
  expect(await deliverProviderIntent({ ...envelope(), category: undefined })).toMatchObject({ kind: "SKIPPED" });
  m.user.mockResolvedValueOnce(null); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind: "SKIPPED" });
  m.preference.mockResolvedValue(false); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind: "SKIPPED" }); expect(m.email).not.toHaveBeenCalled();
});
it("honors audience channel disable", async () => { m.settings.mockResolvedValue({ notificationAudienceControls: { channels: { email: false } } }); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind: "SKIPPED", errorCode: "audience_disabled" }); expect(m.email).not.toHaveBeenCalled(); });
it("uses existing email consent boundary and escaped content with provider receipt", async () => { expect(await deliverProviderIntent(envelope())).toEqual({ kind: "ACCEPTED", providerReference: "provider-ref" }); expect(m.email.mock.calls[0][0]).toMatchObject({ kind: "job_reminder", html: "<p>&lt;private&gt;<br>text</p>" }); });
it.each([
  [{ skipped: true }, "SKIPPED"], [{ acceptance: "NOT_ACCEPTED", retryable: true }, "NOT_ACCEPTED"], [{ ok: false }, "UNCERTAIN"], [{ ok: true }, "UNCERTAIN"],
])("maps email evidence without inferring receipt %#", async (result, kind) => { m.email.mockResolvedValue(result); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind }); });
it.each([[{ ok: true, status: "sent" }, "ACCEPTED"], [{ status: "disabled" }, "SKIPPED"], [{ status: "not_configured" }, "NOT_ACCEPTED"], [{ status: "failed" }, "UNCERTAIN"]])("maps SMS evidence conservatively %#", async (result, kind) => { m.sms.mockResolvedValue(result); expect(await deliverProviderIntent(envelope("SMS"))).toMatchObject({ kind }); });
it.each([[{ ok: true }, "ACCEPTED"], [{ statusCode: 429 }, "NOT_ACCEPTED"], [{ statusCode: 403 }, "NOT_ACCEPTED"], [{ statusCode: 500 }, "UNCERTAIN"], [{}, "UNCERTAIN"]])("handles one push device outcome %#", async (result, kind) => { m.push.mockResolvedValue(result); expect(await deliverProviderIntent(envelope("WEB_PUSH"))).toMatchObject({ kind }); expect(m.subscription).toHaveBeenCalledWith({ where: { id: "device", userId: "admin" } }); });
it("prunes only the revoked current-user device", async () => { m.push.mockResolvedValue({ gone: true, statusCode: 410 }); expect(await deliverProviderIntent(envelope("WEB_PUSH"))).toEqual({ kind: "NOT_ACCEPTED", retryable: false, errorCode: "subscription_revoked" }); expect(m.remove).toHaveBeenCalledWith({ where: { id: "device", userId: "admin", endpoint: "https://push.invalid/fixture" } }); });
it("does not send to missing contact or subscription", async () => { m.user.mockResolvedValue({ id: "admin", role: "ADMIN", isActive: true }); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind: "NOT_ACCEPTED" }); expect(await deliverProviderIntent(envelope("SMS"))).toMatchObject({ kind: "NOT_ACCEPTED" }); expect(await deliverProviderIntent({ ...envelope("WEB_PUSH"), subscriptionId: undefined })).toMatchObject({ kind: "NOT_ACCEPTED" }); m.subscription.mockResolvedValue(null); expect(await deliverProviderIntent(envelope("WEB_PUSH"))).toMatchObject({ kind: "SKIPPED" }); });
it("distinguishes pre-dispatch failure from uncertain transport failure", async () => { m.user.mockRejectedValueOnce(new Error("db unavailable")); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind: "NOT_ACCEPTED", retryable: true }); m.email.mockRejectedValue(new Error("timeout")); expect(await deliverProviderIntent(envelope())).toMatchObject({ kind: "UNCERTAIN" }); });
it("preserves template content and automation kind while rechecking event preference", async () => {
  const event = { ...envelope(), templateRecipientRole: "ADMIN" as const, emailHtml: "<p>Exact template</p>", emailKind: "admin_alert" as const };
  m.eventPreference.mockResolvedValueOnce({ enabled: false }); expect(await deliverProviderIntent(event)).toEqual({ kind: "SKIPPED", errorCode: "event_preference" }); expect(m.email).not.toHaveBeenCalled();
  m.eventPreference.mockResolvedValueOnce({ enabled: true }); expect(await deliverProviderIntent(event)).toMatchObject({ kind: "ACCEPTED" }); expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ html: event.emailHtml, kind: "admin_alert" }));
});
