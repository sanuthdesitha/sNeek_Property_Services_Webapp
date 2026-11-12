// @vitest-environment node
/**
 * Owner decision 2026-11-13: invitations are revocable. Rights are those of
 * "Resend invitation": ADMIN, or OPS_MANAGER with Staff accounts at manage;
 * never upward; never on oneself; never while testing as someone. The list
 * gains a "Revoked" state and filter; a revoked invitation offers a new one.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ops: vi.fn(),
  user: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops, getOpsPolicy: async () => ({ revision: 0, presets: [], assignments: {} }) }));
vi.mock("@/lib/db", () => {
  const tx = { userInvitation: { updateMany: m.updateMany }, auditLog: { create: m.auditCreate } };
  return { db: { user: { findUnique: m.user }, ...tx, $transaction: async (work: (client: unknown) => unknown) => work(tx) } };
});
vi.mock("@/lib/auth/invitations", () => ({ createUserInvitation: vi.fn(), sendInvitationEmail: vi.fn(), buildInvitationUrl: (token: string) => token }));
vi.mock("@/lib/auth/recovery", () => ({ issueRecoveryToken: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/auth/registration-otp", () => ({ issueSignupOtp: vi.fn() }));

import { POST as revoke } from "@/app/api/admin/users/[id]/account-emails/revoke-invitation/route";
import { POST as revokeBulk } from "@/app/api/admin/users/account-emails/revoke/route";
import { buildEmailRow, matchesState, type PersonEmailFacts } from "@/lib/people/account-emails/derive";
import { accountEmailIneligibility, invitationRevokeIneligibility } from "@/lib/accounts/account-email-rules";
import { invitationLinkState } from "@/lib/auth/invitation-state";

const admin = { user: { id: "admin-1", role: "ADMIN", heldRoles: ["ADMIN"] } };
const manager = { user: { id: "ops-1", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const future = new Date(Date.now() + 3 * 86_400_000);
const invited = {
  id: "p1", email: "jane@example.invalid", name: "Jane", role: "CLEANER", isActive: true, emailVerified: null, extraRoles: [],
  invitation: { token: "tok", acceptedAt: null, expiresAt: future, createdAt: new Date(), revokedAt: null },
};
const single = (id = "p1") => revoke(new NextRequest(`https://app.invalid/api/admin/users/${id}/account-emails/revoke-invitation`, { method: "POST" }), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(admin);
  m.ops.mockResolvedValue({ accounts: "manage" });
  m.user.mockResolvedValue(invited);
  m.updateMany.mockResolvedValue({ count: 1 });
  m.auditCreate.mockResolvedValue({});
});

describe("revoke rights", () => {
  it("an administrator revokes; the write is conditional and audited with the actor and role", async () => {
    const response = await single();
    expect(response.status).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith({ where: { userId: "p1", acceptedAt: null, revokedAt: null }, data: { revokedAt: expect.any(Date), revokedById: "admin-1" } });
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ userId: "admin-1", action: "ACCOUNT_INVITATION_REVOKED", entityId: "p1", after: { actorRole: "ADMIN" } });
  });

  it("an operations manager with Staff accounts at manage may revoke; at read only they are refused", async () => {
    m.requireRole.mockResolvedValue(manager);
    expect((await single()).status).toBe(200);
    expect(m.auditCreate.mock.calls[0][0].data.after).toMatchObject({ actorRole: "OPS_MANAGER" });
    m.ops.mockResolvedValue({ accounts: "read" });
    expect((await single()).status).toBe(403);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
  });

  it("never upward and never on oneself", async () => {
    m.requireRole.mockResolvedValue(manager);
    m.user.mockResolvedValue({ ...invited, role: "ADMIN" });
    expect((await single()).status).toBe(403);
    m.user.mockResolvedValue({ ...invited, id: "ops-1", role: "OPS_MANAGER" });
    expect((await single("ops-1")).status).toBe(409);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("never while testing as someone, administrators included", async () => {
    m.requireRole.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    expect((await single()).status).toBe(403);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("an accepted or already withdrawn invitation is refused with the reason; a lost race is 409", async () => {
    m.user.mockResolvedValue({ ...invited, invitation: { ...invited.invitation, acceptedAt: new Date() } });
    expect(await (await single()).json()).toEqual({ error: "The invitation was already accepted." });
    m.user.mockResolvedValue({ ...invited, invitation: { ...invited.invitation, revokedAt: new Date() } });
    expect((await single()).status).toBe(409);
    m.user.mockResolvedValue(invited);
    m.updateMany.mockResolvedValue({ count: 0 });
    expect((await single()).status).toBe(409);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("bulk revokes each person by the same rules and reports refusals", async () => {
    m.user.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "p2" ? { ...invited, id: "p2", invitation: null } : invited));
    const response = await revokeBulk(new NextRequest("https://app.invalid/api/admin/users/account-emails/revoke", { method: "POST", body: JSON.stringify({ userIds: ["p1", "p2"] }) }));
    expect(await response.json()).toEqual({
      revoked: 1,
      results: [
        { userId: "p1", outcome: "revoked", error: null },
        { userId: "p2", outcome: "refused", error: "This person was not invited by link." },
      ],
    });
  });
});

describe("states", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  const facts = (revokedAt: Date | null): PersonEmailFacts => ({
    userId: "p1", name: "Jane", email: "jane@example.invalid", role: "CLEANER", roles: ["CLEANER"], isActive: true, emailVerified: false, lastSeenAt: null, context: null,
    invitation: { createdAt: new Date("2026-11-10T00:00:00Z"), acceptedAt: null, expiresAt: new Date("2026-11-17T00:00:00Z"), createdByName: "Ada", createdById: "admin-1", revokedAt },
    latest: null,
  });
  const viewer = { id: "admin-1", heldRoles: ["ADMIN"] };

  it("a revoked invitation is listed as Revoked, offers a new invitation, and can no longer be revoked or copied", () => {
    const row = buildEmailRow(facts(new Date("2026-11-12T00:00:00Z")), viewer, now);
    expect(row).toMatchObject({ revokedAt: "2026-11-12T00:00:00.000Z", expiresAt: null, canRevoke: false, canCopyLink: false, nextStep: "NEW_INVITATION", canResend: true, needsAction: false });
    expect(matchesState(row, "revoked")).toBe(true);
    const pending = buildEmailRow(facts(null), viewer, now);
    expect(pending).toMatchObject({ revokedAt: null, canRevoke: true, nextStep: "RESEND_INVITATION" });
    expect(matchesState(pending, "revoked")).toBe(false);
    expect(buildEmailRow(facts(null), { refused: "Nope" }, now).canRevoke).toBe(false);
  });

  it("resend stays allowed after a revoke (a fresh invitation); revoke rules", () => {
    const target = { isActive: true, emailVerified: false, invitation: { acceptedAt: null, revokedAt: new Date() } };
    expect(accountEmailIneligibility("INVITATION", target)).toBeNull();
    expect(invitationRevokeIneligibility(target)).toBe("The invitation was already withdrawn.");
    expect(invitationRevokeIneligibility({ ...target, invitation: null })).toBe("This person was not invited by link.");
  });

  it("the link state is withdrawn, distinct from used, expired and invalid", () => {
    const base = { acceptedAt: null, revokedAt: null, expiresAt: future, user: { isActive: true } };
    expect(invitationLinkState(null)).toBe("invalid");
    expect(invitationLinkState(base)).toBe("valid");
    expect(invitationLinkState({ ...base, revokedAt: new Date() })).toBe("revoked");
    expect(invitationLinkState({ ...base, revokedAt: new Date(), expiresAt: new Date(0) })).toBe("revoked");
    expect(invitationLinkState({ ...base, acceptedAt: new Date(), revokedAt: new Date() })).toBe("accepted");
    expect(invitationLinkState({ ...base, expiresAt: new Date(0) })).toBe("expired");
  });
});
