// @vitest-environment node
/**
 * The send half of the email design system (lib/notifications/email.ts +
 * lib/email-design/send-render.ts): every email is rendered again at send
 * time, gets a plain-text part, refuses to send with an empty required value
 * (no provider call, an explicit "not sent"), replies go to the office inbox
 * except on security email, and campaigns carry the one-click unsubscribe.
 * The provider is a spy; no real call is made.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn(), settings: vi.fn(), appSetting: vi.fn(), suppression: vi.fn(), guard: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend: class { emails = { send: m.send }; } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: m.appSetting }, user: { findFirst: vi.fn(async () => null) }, emailSuppression: { findUnique: m.suppression } } }));
vi.mock("@/lib/notifications/safeguards/gate", () => ({
  guardOutbound: m.guard,
  recordOutboundOutcome: vi.fn(async () => undefined),
  refuseOversizedSend: vi.fn(async () => null),
}));

import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildDesignedEmail } from "@/lib/email-design/build-email";
import { renderEmailTemplate, getDefaultEmailTemplates } from "@/lib/email-templates";
import { emailDesign } from "@/lib/email-design/registry";

const SETTINGS = { companyName: "sNeek Property Services", accountsEmail: "office@example.invalid", logoUrl: "", invoicing: { abn: "41 623 904 118", companyAddress: "Suite 4" }, emailTemplates: getDefaultEmailTemplates(), notificationAudienceControls: {}, emailAutomation: {} };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RESEND_API_KEY", "fixture-key");
  vi.stubEnv("NEXTAUTH_SECRET", "fixture-secret-for-unsubscribe-tokens");
  vi.stubEnv("APP_URL", "https://app.example.invalid");
  m.settings.mockResolvedValue(SETTINGS);
  m.appSetting.mockResolvedValue(null);
  m.suppression.mockResolvedValue(null);
  m.guard.mockResolvedValue({ allowed: true, eventId: "evt-1" });
  m.send.mockResolvedValue({ data: { id: "provider-ref" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("send-time rendering", () => {
  it("sends the block design with a plain-text part, the office reply-to and no spec comment", async () => {
    const built = renderEmailTemplate(SETTINGS, "jobAssigned", { userName: "Jane", propertyName: "Manly Loft", jobNumber: "J-1061", jobType: "Deep clean", when: "Fri 13 Nov" });
    const result = await sendEmailDetailed({ to: "jane@example.invalid", subject: built.subject, html: built.html, critical: true });
    expect(result.ok).toBe(true);
    const sent = m.send.mock.calls[0][0];
    expect(sent.subject).toBe("Job assigned — Manly Loft (J-1061)");
    expect(sent.html).toContain("Manly Loft");
    expect(sent.html).not.toContain("sneek-email-spec");
    expect(sent.text).toContain("NEW JOB ASSIGNED");
    expect(sent.text).toContain("Manly Loft");
  });

  it("keeps a caller's prefix on the re-rendered subject", async () => {
    const built = renderEmailTemplate(SETTINGS, "jobRemoved", { userName: "Jane", propertyName: "Manly Loft", jobNumber: "J-1061" });
    await sendEmailDetailed({ to: "jane@example.invalid", subject: `[Test] ${built.subject}`, html: built.html, critical: true });
    expect(m.send.mock.calls[0][0].subject).toBe("[Test] Job removed from your schedule (J-1061)");
  });

  it("uses the published version and the published look at send time", async () => {
    const built = renderEmailTemplate(SETTINGS, "jobRemoved", { userName: "Jane", propertyName: "Manly Loft", jobNumber: "J-1061" });
    const published = { revision: 2, publishedVersion: 2, draft: null, versions: [{ version: 2, savedAt: "2026-11-16T00:00:00Z", actor: { id: "a", name: "A", role: "ADMIN" }, change: "", restoredFrom: null, idempotencyKey: null, doc: { ...emailDesign("jobRemoved")!.defaults, subject: [{ kind: "text", text: "Removed: " }, { kind: "value", name: "jobNumber" }], blocks: emailDesign("jobRemoved")!.defaults.blocks.map((block) => (block.id === "b1" ? { ...block, text: [{ kind: "text", text: "Taken off your list" }] } : block)) } }] };
    const look = { revision: 1, publishedVersion: 2, draft: null, versions: [{ version: 2, savedAt: "2026-11-16T00:00:00Z", actor: { id: "a", name: "A", role: "ADMIN" }, idempotencyKey: null, theme: { preset: "harbour", buttonShape: "pill", replyTo: "replies@example.invalid", senderName: "sNeek Office" } }] };
    m.appSetting.mockImplementation(async ({ where }: { where: { key: string } }) => (where.key === "emailLook" ? { value: look } : where.key === "emailDesign:jobRemoved" ? { value: published } : null));
    await sendEmailDetailed({ to: "jane@example.invalid", subject: built.subject, html: built.html });
    const sent = m.send.mock.calls[0][0];
    expect(sent.subject).toBe("Removed: J-1061");
    expect(sent.html).toContain("Taken off your list");
    expect(sent.html).toContain("#1F4E6B");
    expect(sent.replyTo).toBe("replies@example.invalid");
    expect(sent.from).toMatch(/^"sNeek Office" </);
  });

  it("refuses to send when a required value is empty: no provider call, an explicit not-sent result", async () => {
    const built = buildDesignedEmail(SETTINGS, "twoFactorSignInCode", { code: "", expiryMinutes: "10" });
    const result = await sendEmailDetailed({ to: "jane@example.invalid", subject: built.subject, html: built.html, critical: true });
    expect(result).toMatchObject({ ok: false, acceptance: "NOT_ACCEPTED", retryable: false });
    expect(result.error).toContain("Code");
    expect(result.skipped).toBeFalsy();
    expect(m.send).not.toHaveBeenCalled();
    expect(m.guard).not.toHaveBeenCalled();
  });

  it("security email sets no reply-to (no-reply) and keeps its fixed words", async () => {
    const built = buildDesignedEmail(SETTINGS, "twoFactorSignInCode", { code: "482913", expiryMinutes: "10" });
    await sendEmailDetailed({ to: "jane@example.invalid", subject: built.subject, html: built.html, critical: true });
    const sent = m.send.mock.calls[0][0];
    expect(sent.replyTo).toBeUndefined();
    expect(sent.subject).not.toContain("482913");
    expect(sent.html).toContain("Never share this code");
    expect(sent.html).not.toContain("Email preferences");
  });

  it("puts an HTML body from the wording layer on the base layout, with a text part", async () => {
    await sendEmailDetailed({ to: "jane@example.invalid", subject: "Laundry: Bondi", html: "<p>Bags are by the door.</p>" });
    const sent = m.send.mock.calls[0][0];
    expect(sent.html.startsWith("<!doctype html>")).toBe(true);
    expect(sent.html).toContain("Bags are by the door.");
    expect(sent.html).toContain("ABN 41 623 904 118");
    expect(sent.text).toContain("Bags are by the door.");
  });
});

describe("campaigns", () => {
  it("carry a signed one-click unsubscribe link and List-Unsubscribe headers", async () => {
    await sendEmailDetailed({ to: "client@example.invalid", subject: "Spring offer", html: "<p>15% off deep cleans.</p>", marketing: true });
    const sent = m.send.mock.calls[0][0];
    expect(sent.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\/[^>]+\/api\/public\/unsubscribe\?t=[^>]+>/);
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.html).toContain("Unsubscribe");
    expect(sent.text).toContain("Unsubscribe: ");
  });

  it("are not sent to an address that unsubscribed from campaigns", async () => {
    m.suppression.mockResolvedValue({ reason: "MARKETING_OPT_OUT" });
    const result = await sendEmailDetailed({ to: "client@example.invalid", subject: "Spring offer", html: "<p>x</p>", marketing: true });
    expect(result).toMatchObject({ ok: false, skipped: true, error: "unsubscribed_from_campaigns" });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("operational email never carries the unsubscribe link or headers, and a campaign opt-out does not stop it", async () => {
    m.suppression.mockResolvedValue({ reason: "MARKETING_OPT_OUT" });
    const built = renderEmailTemplate(SETTINGS, "jobAssigned", { userName: "Jane", propertyName: "Manly Loft", jobNumber: "J-1061" });
    const result = await sendEmailDetailed({ to: "client@example.invalid", subject: built.subject, html: built.html });
    expect(result.ok).toBe(true);
    const sent = m.send.mock.calls[0][0];
    expect(sent.headers).toBeUndefined();
    expect(sent.html).not.toContain("unsubscribe");
  });
});
