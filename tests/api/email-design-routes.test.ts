// @vitest-environment node
/**
 * Email design routes: publishing is ADMIN only, with the person's own PIN in
 * the same request (verifySensitiveAction), refused while impersonating;
 * operations managers with the communications pack at Manage may draft and
 * test, never publish; a test goes only to the signed-in person's own account
 * address through the real send function; the Email look is ADMIN only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), ops: vi.fn(), verify: vi.fn(), publish: vi.fn(), saveDraft: vi.fn(), restore: vi.fn(), reset: vi.fn(), discard: vi.fn(),
  view: vi.fn(), email: vi.fn(), user: vi.fn(), audit: vi.fn(), theme: vi.fn(), doc: vi.fn(), settings: vi.fn(), publishTheme: vi.fn(), lookView: vi.fn(), saveTheme: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/email-design/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email-design/store")>("@/lib/email-design/store");
  return { ...actual, publishDesign: m.publish, saveDesignDraft: m.saveDraft, restoreDesignVersion: m.restore, resetDesignToStandard: m.reset, discardDesignDraft: m.discard, getPublishedEmailTheme: m.theme, getPublishedDocument: m.doc, publishTheme: m.publishTheme, saveThemeDraft: m.saveTheme };
});
vi.mock("@/lib/email-design/view", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email-design/view")>("@/lib/email-design/view");
  return { ...actual, designView: m.view, lookView: m.lookView };
});
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, auditLog: { create: m.audit } } }));

import { POST as PUBLISH } from "@/app/api/admin/notifications/email-designs/[key]/publish/route";
import { PUT as DRAFT } from "@/app/api/admin/notifications/email-designs/[key]/route";
import { POST as TEST } from "@/app/api/admin/notifications/email-designs/[key]/test/route";
import { POST as LOOK_PUBLISH } from "@/app/api/admin/notifications/email-look/publish/route";
import { PUT as LOOK_PUT } from "@/app/api/admin/notifications/email-look/route";
import { SensitiveVerificationError } from "@/lib/security/admin-verification";
import { DEFAULT_EMAIL_THEME } from "@/lib/email-design/theme";
import { emailDesign } from "@/lib/email-design/registry";

const params = { params: { key: "jobReminder24h" } };
const request = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const admin = { user: { id: "admin-1", name: "Hannah Lee", role: Role.ADMIN, heldRoles: [Role.ADMIN] } };
const ops = { user: { id: "ops-1", name: "Ravi Mehta", role: Role.OPS_MANAGER, heldRoles: [Role.OPS_MANAGER] } };
const row = { revision: 3, publishedVersion: null, draft: null, versions: [] };

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue(admin);
  m.ops.mockResolvedValue({ communications: "manage" });
  m.verify.mockResolvedValue(true);
  m.publish.mockResolvedValue({ row, version: 4 });
  m.saveDraft.mockResolvedValue(row);
  m.view.mockResolvedValue({ key: "jobReminder24h", row });
  m.lookView.mockResolvedValue({ row });
  m.publishTheme.mockResolvedValue({ row, version: 2 });
  m.saveTheme.mockResolvedValue(row);
  m.theme.mockResolvedValue(DEFAULT_EMAIL_THEME);
  m.doc.mockResolvedValue(null);
  m.settings.mockResolvedValue({ companyName: "sNeek Property Services", accountsEmail: "office@example.invalid" });
  m.user.mockResolvedValue({ email: "hannah@example.invalid", isActive: true });
  m.email.mockResolvedValue({ ok: true, externalId: "ref", acceptance: "ACCEPTED" });
});

describe("publishing an email", () => {
  it("ADMIN with their own PIN publishes; the PIN is checked in the same request against the actual person", async () => {
    const response = await PUBLISH(request({ expectedRevision: 3, idempotencyKey: "publish-key-1", security: { pin: "2468" } }), params);
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "2468" });
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ key: "jobReminder24h", expectedRevision: 3, idempotencyKey: "publish-key-1", actor: { id: "admin-1", name: "Hannah Lee", role: "ADMIN" } }));
  });

  it("a wrong or missing PIN is refused (423) and nothing is published", async () => {
    m.verify.mockRejectedValue(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION" as never));
    const response = await PUBLISH(request({ expectedRevision: 3, security: { pin: "0000" } }), params);
    expect(response.status).toBe(423);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("an operations manager (even with Manage) may not publish", async () => {
    m.session.mockResolvedValue(ops);
    const response = await PUBLISH(request({ expectedRevision: 3, security: { pin: "2468" } }), params);
    expect(response.status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("is refused while impersonating", async () => {
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    const response = await PUBLISH(request({ expectedRevision: 3, security: { pin: "2468" } }), params);
    expect(response.status).toBe(403);
    expect(m.publish).not.toHaveBeenCalled();
  });
});

describe("drafts", () => {
  it("an operations manager with the communications pack at Manage may save a draft", async () => {
    m.session.mockResolvedValue(ops);
    const doc = emailDesign("jobReminder24h")!.defaults;
    const response = await DRAFT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ action: "DRAFT", doc, expectedRevision: 3, idempotencyKey: "draft-key-1" }) }), params);
    expect(response.status).toBe(200);
    expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ key: "jobReminder24h", expectedRevision: 3, idempotencyKey: "draft-key-1", actor: { id: "ops-1", name: "Ravi Mehta", role: "OPS_MANAGER" } }));
  });

  it("an operations manager with view-only access cannot", async () => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ communications: "view" });
    const response = await DRAFT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ action: "DRAFT", doc: {}, expectedRevision: 3 }) }), params);
    expect(response.status).toBe(403);
    expect(m.saveDraft).not.toHaveBeenCalled();
  });

  it("restore and reset only change the draft", async () => {
    m.restore.mockResolvedValue(row);
    m.reset.mockResolvedValue(row);
    await DRAFT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ action: "RESTORE", version: 2, expectedRevision: 3 }) }), params);
    await DRAFT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ action: "RESET", expectedRevision: 3 }) }), params);
    expect(m.restore).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(m.reset).toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });
});

describe("send a test to myself", () => {
  it("goes only to the signed-in person's own account address, marked [Test], through the send function and the safeguards", async () => {
    const response = await TEST(request({ to: "someone-else@example.invalid", sampleId: "typical" }), params);
    expect(response.status).toBe(200);
    expect(m.user).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "admin-1" } }));
    expect(m.email).toHaveBeenCalledTimes(1);
    const payload = m.email.mock.calls[0][0];
    expect(payload.to).toBe("hannah@example.invalid");
    expect(payload.subject).toMatch(/^\[Test\] /);
    expect(payload.safeguard).toMatchObject({ typeKey: "job.reminder.scheduled", recipientUserId: "admin-1" });
    expect(payload.critical).toBeUndefined();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "EMAIL_DESIGN_TEST_SENT", userId: "admin-1" }) }));
    expect(await response.json()).toMatchObject({ state: "provider_accepted" });
  });

  it("an operations manager who may draft can test to themselves", async () => {
    m.session.mockResolvedValue(ops);
    m.user.mockResolvedValue({ email: "ravi@example.invalid", isActive: true });
    await TEST(request({}), params);
    expect(m.email.mock.calls[0][0].to).toBe("ravi@example.invalid");
  });

  it("is refused while impersonating", async () => {
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    const response = await TEST(request({}), params);
    expect(response.status).toBe(403);
    expect(m.email).not.toHaveBeenCalled();
  });
});

describe("Email look", () => {
  it("is ADMIN only to change, and publishing needs the PIN", async () => {
    m.session.mockResolvedValue(ops);
    expect((await LOOK_PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ action: "DRAFT", theme: DEFAULT_EMAIL_THEME, expectedRevision: 0 }) }))).status).toBe(403);
    expect((await LOOK_PUBLISH(request({ expectedRevision: 0, security: { pin: "2468" } }))).status).toBe(403);
    m.session.mockResolvedValue(admin);
    expect((await LOOK_PUBLISH(request({ expectedRevision: 0, security: { pin: "2468" } }))).status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "2468" });
    expect(m.publishTheme).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ id: "admin-1", role: "ADMIN" }) }));
  });
});
