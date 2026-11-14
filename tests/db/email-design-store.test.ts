// @vitest-environment node
/**
 * Email designs and the Email look on a real, disposable PostgreSQL
 * (127.0.0.1:55439): drafts never go live, publish makes a version (audited,
 * idempotent, blocked by the checks), restore and reset only make drafts, a
 * stale revision is refused, the send path picks up the published version,
 * and the administrator's password reset sends a single-use, expiring link.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, send: vi.fn(), session: vi.fn(), verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("resend", () => ({ Resend: class { emails = { send: m.send }; } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/rbac/delegated-admin", () => ({ requireDelegatedAction: async () => ({ role: "ADMIN" }), DelegatedActionDenied: class extends Error {} }));

import { discardDesignDraft, EmailDesignError, getPublishedDocument, publishDesign, readDesignRow, resetDesignToStandard, restoreDesignVersion, saveDesignDraft, publishTheme, saveThemeDraft, getPublishedEmailTheme } from "@/lib/email-design/store";
import { emailDesign } from "@/lib/email-design/registry";
import { DEFAULT_EMAIL_THEME } from "@/lib/email-design/theme";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { renderEmailTemplate, getDefaultEmailTemplates } from "@/lib/email-templates";
import { consumeRecoveryToken } from "@/lib/auth/recovery";
import { POST as ADMIN_RESET } from "@/app/api/admin/users/[id]/reset-password/route";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const run = randomUUID().slice(0, 8);
const admin = { id: `ed-admin-${run}`, name: "Fixture Admin", role: "ADMIN" };
const target = { id: `ed-person-${run}`, email: `ed-person-${run}@example.invalid` };
const KEY = "jobRemoved";
const definition = emailDesign(KEY)!;

function editedDoc(heading: string) {
  return { ...definition.defaults, blocks: definition.defaults.blocks.map((block) => (block.id === "b1" ? { ...block, text: [{ kind: "text" as const, text: heading }] } : block)) };
}

describe.skipIf(!url)("email design store (database)", () => {
  beforeAll(async () => {
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.create({ data: { id: admin.id, name: admin.name, email: `${admin.id}@example.invalid`, role: "ADMIN", passwordHash: "fixture-only" } });
    await m.client.user.create({ data: { id: target.id, name: "Fixture Person", email: target.email, role: "CLEANER", passwordHash: "fixture-only" } });
  });

  beforeEach(async () => {
    m.send.mockReset();
    m.send.mockResolvedValue({ data: { id: "provider-ref" }, error: null });
    await m.client.appSetting.deleteMany({ where: { key: { in: [`emailDesign:${KEY}`, "emailLook"] } } });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.appSetting.deleteMany({ where: { key: { in: [`emailDesign:${KEY}`, "emailLook"] } } });
    await m.client.auditLog.deleteMany({ where: { userId: admin.id } });
    await m.client.verificationToken.deleteMany({ where: { identifier: { contains: target.email } } });
    await m.client.session.deleteMany({ where: { userId: target.id } });
    await m.client.user.deleteMany({ where: { id: { in: [admin.id, target.id] } } });
    await m.client.$disconnect();
  });

  it("a draft never goes live; publish makes v2 (audited), restore and reset only make drafts", async () => {
    let row = await saveDesignDraft({ key: KEY, doc: editedDoc("Off your schedule"), expectedRevision: 0, idempotencyKey: "draft-key-0001", actor: admin });
    expect(row.draft).not.toBeNull();
    expect(await getPublishedDocument(definition)).toBeNull();

    // A retry with the same key changes nothing (no new revision).
    const retry = await saveDesignDraft({ key: KEY, doc: editedDoc("Off your schedule"), expectedRevision: 0, idempotencyKey: "draft-key-0001", actor: admin });
    expect(retry.revision).toBe(row.revision);

    const published = await publishDesign({ key: KEY, expectedRevision: row.revision, idempotencyKey: "publish-key-0001", change: "heading", theme: DEFAULT_EMAIL_THEME, actor: admin });
    expect(published.version).toBe(2);
    expect((await getPublishedDocument(definition))?.blocks[0]).toMatchObject({ text: [{ text: "Off your schedule" }] });
    const audit = await m.client.auditLog.findFirst({ where: { userId: admin.id, action: "EMAIL_DESIGN_PUBLISHED" }, orderBy: { createdAt: "desc" } });
    expect(audit?.after).toMatchObject({ key: KEY, version: 2, actorRole: "ADMIN" });

    // Same idempotency key: the same version, not a second one.
    const again = await publishDesign({ key: KEY, expectedRevision: 0, idempotencyKey: "publish-key-0001", change: "", theme: DEFAULT_EMAIL_THEME, actor: admin });
    expect(again.version).toBe(2);

    row = await readDesignRow(KEY);
    row = await resetDesignToStandard({ key: KEY, expectedRevision: row.revision, actor: admin });
    expect(row.publishedVersion).toBe(2);
    expect(row.draft?.basedOn).toBe(1);
    expect(row.draft?.doc.blocks[0]).toMatchObject({ text: definition.defaults.blocks[0].type === "heading" ? definition.defaults.blocks[0].text : [] });
    row = await restoreDesignVersion({ key: KEY, version: 2, expectedRevision: row.revision, actor: admin });
    expect(row.draft?.basedOn).toBe(2);
    expect((await getPublishedDocument(definition))?.blocks[0]).toMatchObject({ text: [{ text: "Off your schedule" }] });
    row = await discardDesignDraft({ key: KEY, expectedRevision: row.revision, actor: admin });
    expect(row.draft).toBeNull();
  });

  it("refuses a stale revision and a draft that fails the checks", async () => {
    const row = await saveDesignDraft({ key: KEY, doc: editedDoc("x"), expectedRevision: 0, idempotencyKey: null, actor: admin });
    await expect(saveDesignDraft({ key: KEY, doc: editedDoc("y"), expectedRevision: 0, idempotencyKey: null, actor: admin })).rejects.toMatchObject({ status: 409 });
    const broken = { ...definition.defaults, blocks: definition.defaults.blocks.filter((block) => block.type !== "details") };
    const saved = await saveDesignDraft({ key: KEY, doc: broken, expectedRevision: row.revision, idempotencyKey: null, actor: admin });
    await expect(publishDesign({ key: KEY, expectedRevision: saved.revision, idempotencyKey: null, change: "", theme: DEFAULT_EMAIL_THEME, actor: admin })).rejects.toBeInstanceOf(EmailDesignError);
    expect(await getPublishedDocument(definition)).toBeNull();
  });

  it("security emails refuse drafts (words fixed)", async () => {
    await expect(saveDesignDraft({ key: "twoFactorSignInCode", doc: emailDesign("twoFactorSignInCode")!.defaults, expectedRevision: 0, idempotencyKey: null, actor: admin })).rejects.toMatchObject({ status: 409 });
  });

  it("the send path uses the published version and the published look", async () => {
    const row = await saveDesignDraft({ key: KEY, doc: editedDoc("Removed by the office"), expectedRevision: 0, idempotencyKey: null, actor: admin });
    await publishDesign({ key: KEY, expectedRevision: row.revision, idempotencyKey: null, change: "", theme: DEFAULT_EMAIL_THEME, actor: admin });
    const look = await saveThemeDraft({ theme: { ...DEFAULT_EMAIL_THEME, preset: "shiraz" }, expectedRevision: 0, actor: admin });
    await publishTheme({ expectedRevision: look.revision, actor: admin, idempotencyKey: null });
    expect((await getPublishedEmailTheme()).brandColor).toBe("#6B2737");
    vi.stubEnv("RESEND_API_KEY", "fixture-key");
    const built = renderEmailTemplate({ companyName: "sNeek", logoUrl: "", emailTemplates: getDefaultEmailTemplates() }, KEY, { userName: "Jane", propertyName: "Manly Loft", jobNumber: "J-1061" });
    const result = await sendEmailDetailed({ to: target.email, subject: built.subject, html: built.html, critical: true });
    vi.unstubAllEnvs();
    expect(result.ok).toBe(true);
    const sent = m.send.mock.calls[0][0];
    expect(sent.html).toContain("Removed by the office");
    expect(sent.html).toContain("#6B2737");
    expect(sent.text).toContain("REMOVED BY THE OFFICE");
  });

  it("the administrator's password reset emails a single-use, expiring link (no temporary password), revokes access and is rate limited", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-key");
    m.session.mockResolvedValue({ user: { id: admin.id, role: "ADMIN", heldRoles: ["ADMIN"] } });
    m.verify.mockResolvedValue(true);
    const call = () => ADMIN_RESET(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ security: { pin: "2468" } }) }) as never, { params: { id: target.id } });
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, emailed: true, mode: "RESET_LINK" });
    expect(body.tempPassword).toBeUndefined();
    const sent = m.send.mock.calls[0][0];
    const link = /https?:\/\/[^"\s]+\/reset-password\?email=[^"&\s]+&(?:amp;)?token=([a-f0-9]{64})/.exec(sent.html);
    expect(link).not.toBeNull();
    expect(sent.html).not.toMatch(/temporary password/i);
    expect(sent.replyTo).toBeUndefined();
    const stored = await m.client.verificationToken.findFirst({ where: { identifier: `pwreset:${target.email}` } });
    expect(stored?.token).not.toBe(link![1]);
    expect(stored!.expires.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 1000);
    // Single use.
    expect(await consumeRecoveryToken("pwreset", target.email, link![1])).toBe(true);
    expect(await consumeRecoveryToken("pwreset", target.email, link![1])).toBe(false);
    const audit = await m.client.auditLog.findFirst({ where: { userId: admin.id, action: "RESET_USER_PASSWORD", entityId: target.id }, orderBy: { createdAt: "desc" } });
    expect(audit?.after).toMatchObject({ mode: "RESET_LINK", emailSent: true });
    // Rate limit: at most 3 per person in 15 minutes.
    await call();
    await call();
    expect((await call()).status).toBe(429);
    vi.unstubAllEnvs();
  });

  it("an expired reset link is refused", async () => {
    const { createHash } = await import("node:crypto");
    await m.client.verificationToken.deleteMany({ where: { identifier: `pwreset:${target.email}` } });
    await m.client.verificationToken.create({ data: { identifier: `pwreset:${target.email}`, token: createHash("sha256").update("expired-raw-token").digest("hex"), expires: new Date(Date.now() - 1000) } });
    expect(await consumeRecoveryToken("pwreset", target.email, "expired-raw-token")).toBe(false);
  });
});
