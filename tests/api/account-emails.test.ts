// @vitest-environment node
/**
 * Accounts › Account emails (owner: "allow re-send any invitations or emails
 * related to new accounts, password resets, etc."): fresh token per send,
 * sent to the person's own address only, cool-down per person and type,
 * audited with the real sender and the provider's answer; ADMIN, or
 * OPS_MANAGER with Staff accounts at manage; never while impersonating; never
 * to a higher role.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ops: vi.fn(),
  user: vi.fn(),
  users: vi.fn(),
  auditFind: vi.fn(),
  auditCreate: vi.fn(),
  createInvitation: vi.fn(),
  sendInvitation: vi.fn(),
  issueToken: vi.fn(),
  sendEmail: vi.fn(),
  issueOtp: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
// The live policy behind the shared capability evaluator (lib/rbac/can.ts): no per-person switches.
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops, getOpsPolicy: async () => ({ revision: 0, presets: [], assignments: {} }) }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user, findMany: m.users }, auditLog: { findMany: m.auditFind, create: m.auditCreate } } }));
vi.mock("@/lib/auth/invitations", () => ({
  createUserInvitation: m.createInvitation,
  sendInvitationEmail: m.sendInvitation,
  buildInvitationUrl: (token: string) => `https://app.invalid/accept-invite/${token}`,
}));
vi.mock("@/lib/auth/recovery", () => ({ issueRecoveryToken: m.issueToken, appBaseUrl: () => "https://app.invalid", RECOVERY_TTL_MINUTES: 30 }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.sendEmail }));
vi.mock("@/lib/auth/registration-otp", () => ({ issueSignupOtp: m.issueOtp }));

import { GET, POST } from "@/app/api/admin/users/[id]/account-emails/route";
import { POST as copyLink } from "@/app/api/admin/users/[id]/account-emails/invitation-link/route";
import { accountEmailIneligibility, roleAboveRefusal, resendInviteType } from "@/lib/accounts/account-email-rules";

const admin = { user: { id: "admin-1", role: "ADMIN", heldRoles: ["ADMIN"] } };
const manager = { user: { id: "ops-1", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const future = new Date(Date.now() + 3 * 86_400_000);
const invited = {
  id: "p1", email: "Jane@Example.invalid", name: "Jane", role: "CLEANER", isActive: true, emailVerified: null, extraRoles: [],
  invitation: { token: "old-token", acceptedAt: null, expiresAt: future, createdAt: new Date() },
};
const active = { ...invited, emailVerified: new Date(), invitation: { ...invited.invitation, acceptedAt: new Date() } };
const post = (type: string) => POST(new NextRequest("https://app.invalid/api/admin/users/p1/account-emails", { method: "POST", body: JSON.stringify({ type }) }), { params: { id: "p1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(admin);
  m.ops.mockResolvedValue({ accounts: "manage" });
  m.user.mockResolvedValue(invited);
  m.users.mockResolvedValue([{ id: "admin-1", name: "Ada Admin", email: "ada@x" }]);
  m.auditFind.mockResolvedValue([]);
  m.createInvitation.mockResolvedValue({ token: "new-token", expiresAt: future });
  m.sendInvitation.mockResolvedValue({ ok: true, acceptance: "ACCEPTED", skipped: false, externalId: "re_1" });
  m.issueToken.mockResolvedValue("raw-reset");
  m.sendEmail.mockResolvedValue({ ok: true, acceptance: "ACCEPTED", externalId: "re_2" });
  m.issueOtp.mockResolvedValue({ ok: true, acceptance: "ACCEPTED", externalId: "re_3" });
});

describe("resend an invitation", () => {
  it("issues a fresh invitation token, emails the person's own address and audits the provider's answer", async () => {
    const response = await post("INVITATION");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: "INVITATION", to: "jane@example.invalid", state: "ACCEPTED", stateLabel: expect.stringContaining("delivery not confirmed") });
    expect(m.createInvitation).toHaveBeenCalledWith({ userId: "p1", createdById: "admin-1" });
    expect(m.sendInvitation).toHaveBeenCalledWith(expect.objectContaining({ to: "jane@example.invalid", url: "https://app.invalid/accept-invite/new-token" }));
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: "admin-1", action: "ACCOUNT_EMAIL_SENT", entity: "User", entityId: "p1",
      after: { type: "INVITATION", origin: "PERSON_PANEL", to: "jane@example.invalid", state: "ACCEPTED", actorRole: "ADMIN", sentBy: "OFFICE", deliveryConfirmed: false },
    });
  });

  it("records a provider failure truthfully (never as sent)", async () => {
    m.sendInvitation.mockResolvedValue({ ok: false, error: "RESEND_API_KEY is not configured", acceptance: "NOT_ACCEPTED", skipped: false, externalId: null });
    expect(await (await post("INVITATION")).json()).toMatchObject({ state: "SKIPPED" });
    m.sendInvitation.mockResolvedValue({ ok: false, error: "timeout", acceptance: "UNKNOWN", skipped: false, externalId: null });
    expect(await (await post("INVITATION")).json()).toMatchObject({ state: "UNKNOWN" });
  });

  it("refuses within the cool-down for the same person and type, but not after a refused send", async () => {
    m.auditFind.mockResolvedValue([{ createdAt: new Date(), after: { type: "INVITATION", state: "ACCEPTED" } }]);
    const response = await post("INVITATION");
    expect(response.status).toBe(429);
    expect(m.createInvitation).not.toHaveBeenCalled();
    expect(m.auditFind.mock.calls[0][0].where).toMatchObject({ action: "ACCOUNT_EMAIL_SENT", entityId: "p1", after: { path: ["type"], equals: "INVITATION" } });
    m.auditFind.mockResolvedValue([{ createdAt: new Date(), after: { type: "INVITATION", state: "NOT_ACCEPTED" } }]);
    expect((await post("INVITATION")).status).toBe(200);
  });

  it("refuses an invitation already accepted, and a disabled account", async () => {
    m.user.mockResolvedValue(active);
    expect((await post("INVITATION")).status).toBe(409);
    m.user.mockResolvedValue({ ...invited, isActive: false });
    expect((await post("INVITATION")).status).toBe(409);
    expect(m.sendInvitation).not.toHaveBeenCalled();
  });
});

describe("password reset link and sign-up code", () => {
  it("sends the reset link to THAT person's account address only, with a fresh token", async () => {
    m.user.mockResolvedValue(active);
    const response = await post("PASSWORD_RESET");
    expect(response.status).toBe(200);
    expect(m.issueToken).toHaveBeenCalledWith("pwreset", "jane@example.invalid");
    const email = m.sendEmail.mock.calls[0][0];
    expect(email).toMatchObject({ to: "jane@example.invalid", critical: true, transactional: true });
    // The link sits in an escaped href (block design "resetPassword"): & is written &amp; in HTML.
    expect(email.html.replace(/&amp;/g, "&")).toContain("https://app.invalid/reset-password?email=jane%40example.invalid&token=raw-reset");
    expect(email.html).toContain("Our office sent you a link");
  });

  it("sends a fresh sign-up code only to a self-registered unverified login", async () => {
    m.user.mockResolvedValue({ ...invited, invitation: null });
    expect((await post("SIGNUP_CODE")).status).toBe(200);
    expect(m.issueOtp).toHaveBeenCalledWith("jane@example.invalid", { enforceCooldown: true });
    m.user.mockResolvedValue(invited);
    expect((await post("SIGNUP_CODE")).status).toBe(409);
  });
});

describe("who may send", () => {
  it("lets an operations manager with Staff accounts at manage send, but not to an administrator", async () => {
    m.requireRole.mockResolvedValue(manager);
    expect((await post("INVITATION")).status).toBe(200);
    expect(m.auditCreate.mock.calls[0][0].data.after.actorRole).toBe("OPS_MANAGER");
    m.user.mockResolvedValue({ ...invited, role: "ADMIN" });
    const refused = await post("INVITATION");
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatch(/role is above yours/);
    // An extra ADMIN role counts too.
    m.user.mockResolvedValue({ ...invited, extraRoles: [{ role: "ADMIN" }] });
    expect((await post("INVITATION")).status).toBe(403);
  });

  it("refuses an operations manager whose pack is read only, and anyone impersonating", async () => {
    m.requireRole.mockResolvedValue(manager);
    m.ops.mockResolvedValue({ accounts: "read" });
    expect((await post("INVITATION")).status).toBe(403);
    m.requireRole.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    expect((await post("INVITATION")).status).toBe(403);
    expect(m.createInvitation).not.toHaveBeenCalled();
  });

  it("lets a read-only viewer see the history with the reason they cannot send", async () => {
    m.requireRole.mockResolvedValue(manager);
    m.ops.mockResolvedValue({ accounts: "read" });
    m.auditFind
      .mockResolvedValueOnce([
        { id: "a1", action: "CREATE_USER", createdAt: new Date("2026-11-01T00:00:00Z"), userId: "admin-1", after: { activationMode: "ADMIN_CREATED_INVITE", invitationEmailSent: true, email: "jane@example.invalid" } },
        { id: "a2", action: "RESET_USER_PASSWORD", createdAt: new Date("2026-11-02T00:00:00Z"), userId: "admin-1", after: {} },
      ])
      .mockResolvedValueOnce([]);
    const body = await (await GET(new NextRequest("https://app.invalid/api/admin/users/p1/account-emails"), { params: { id: "p1" } })).json();
    expect(body.options.every((option: { allowed: boolean }) => !option.allowed)).toBe(true);
    expect(body.options[0].reason).toMatch(/Staff accounts/);
    expect(body.history.map((entry: { label: string; state: string }) => [entry.label, entry.state])).toEqual([
      ["Temporary password (administrator reset)", "NOT_RECORDED"],
      ["Invitation to set a password (account created)", "ACCEPTED"],
    ]);
    expect(JSON.stringify(body)).not.toContain("old-token");
  });
});

describe("copy invitation link", () => {
  it("returns the pending link without re-issuing it, audited; refuses an accepted invitation", async () => {
    const response = await copyLink(new NextRequest("https://app.invalid/x", { method: "POST" }), { params: { id: "p1" } });
    expect(await response.json()).toMatchObject({ link: "https://app.invalid/accept-invite/old-token" });
    expect(m.createInvitation).not.toHaveBeenCalled();
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ action: "ACCOUNT_INVITATION_LINK_COPIED", entityId: "p1" });
    m.user.mockResolvedValue(active);
    expect((await copyLink(new NextRequest("https://app.invalid/x", { method: "POST" }), { params: { id: "p1" } })).status).toBe(409);
  });
});

describe("rules", () => {
  it("ranks roles and picks the email Resend invite means", () => {
    expect(roleAboveRefusal(["OPS_MANAGER"], ["ADMIN"])).not.toBeNull();
    expect(roleAboveRefusal(["OPS_MANAGER"], ["OPS_MANAGER"])).toBeNull();
    expect(roleAboveRefusal(["ADMIN"], ["ADMIN"])).toBeNull();
    expect(resendInviteType({ isActive: true, emailVerified: false, invitation: { acceptedAt: null } })).toBe("INVITATION");
    expect(resendInviteType({ isActive: true, emailVerified: false, invitation: null })).toBe("SIGNUP_CODE");
    expect(accountEmailIneligibility("PASSWORD_RESET", { isActive: true, emailVerified: false, invitation: { acceptedAt: null } })).toMatch(/Resend the invitation/);
  });
});
