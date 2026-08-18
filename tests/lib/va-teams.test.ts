import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));

// vi.mock factories are hoisted above module-level consts, so the mock db has
// to be created inside vi.hoisted to exist by the time the factory runs.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    property: { findMany: vi.fn() },
    vaTeam: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

vi.mock("@/lib/auth/invitations", () => ({
  createUserInvitation: vi.fn(async () => ({ token: "tok_abc", expiresAt: new Date("2026-09-01") })),
  buildInvitationUrl: (t: string) => `https://app.test/accept-invite/${t}`,
  sendInvitationEmail: vi.fn(async () => ({ ok: true })),
}));

import {
  assertTeamManager,
  createVaTeam,
  updateVaTeam,
  deleteVaTeam,
  inviteVaMember,
  removeVaMember,
} from "@/lib/va/teams";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation(async (fn: any) => fn(dbMock));
});

/**
 * The escalation guard. Everything else in the VA feature is a permission
 * check; this is the one that stops a VA rewriting those permissions.
 */
describe("assertTeamManager", () => {
  it("allows the client themselves", () => {
    expect(() => assertTeamManager({ actor: "CLIENT" })).not.toThrow();
  });

  it("REFUSES a VA, so delegation cannot widen itself", () => {
    expect(() => assertTeamManager({ actor: "VA" })).toThrow("FORBIDDEN");
  });
});

describe("property scope is validated against ownership", () => {
  it("rejects a property the client does not own instead of dropping it", async () => {
    // Only one of the two ids comes back as owned.
    dbMock.property.findMany.mockResolvedValue([{ id: "prop_mine" }]);

    await expect(
      createVaTeam({
        clientId: "client_1",
        createdById: "user_1",
        name: "Team",
        propertyIds: ["prop_mine", "prop_not_theirs"],
      })
    ).rejects.toThrow("PROPERTY_NOT_FOUND");

    expect(dbMock.vaTeam.create).not.toHaveBeenCalled();
  });

  it("scopes the ownership lookup to the acting client", async () => {
    dbMock.property.findMany.mockResolvedValue([{ id: "prop_a" }]);
    dbMock.vaTeam.create.mockResolvedValue({ id: "team_1" });

    await createVaTeam({ clientId: "client_1", createdById: "user_1", name: "T", propertyIds: ["prop_a"] });

    expect(dbMock.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: "client_1", id: { in: ["prop_a"] } } })
    );
  });
});

describe("createVaTeam", () => {
  it("grants nothing when no permissions are supplied", async () => {
    dbMock.vaTeam.create.mockResolvedValue({ id: "team_1" });

    await createVaTeam({ clientId: "client_1", createdById: "user_1", name: "Assistants" });

    const data = dbMock.vaTeam.create.mock.calls[0][0].data;
    expect(Object.values(data.permissions).every((v) => v === false)).toBe(true);
  });
});

describe("updateVaTeam", () => {
  it("refuses a team belonging to another client", async () => {
    dbMock.vaTeam.findFirst.mockResolvedValue(null);

    await expect(
      updateVaTeam({ clientId: "client_1", teamId: "team_of_client_2", name: "x" })
    ).rejects.toThrow("TEAM_NOT_FOUND");

    expect(dbMock.vaTeam.update).not.toHaveBeenCalled();
  });

  it("clears the scope with Prisma.DbNull, which a bare null would fail at runtime", async () => {
    dbMock.vaTeam.findFirst.mockResolvedValue({ id: "team_1", clientId: "client_1", name: "T" });
    dbMock.vaTeam.update.mockResolvedValue({ id: "team_1" });

    await updateVaTeam({ clientId: "client_1", teamId: "team_1", propertyIds: [] });

    // Prisma rejects a plain null for a nullable Json column; asserting the
    // sentinel is what stops that regression coming back.
    expect(dbMock.vaTeam.update.mock.calls[0][0].data.propertyIds).toBe(Prisma.DbNull);
  });
});

describe("inviteVaMember", () => {
  beforeEach(() => {
    dbMock.vaTeam.findFirst.mockResolvedValue({ id: "team_1", clientId: "client_1", name: "Team" });
  });

  it("creates an inert VA login - no password hash until the invite is accepted", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.user.create.mockResolvedValue({ id: "user_va", email: "va@test.com", name: "VA" });

    await inviteVaMember({
      clientId: "client_1",
      teamId: "team_1",
      email: "va@test.com",
      invitedById: "user_1",
    });

    const data = dbMock.user.create.mock.calls[0][0].data;
    expect(data.role).toBe("VA");
    expect(data.vaTeamId).toBe("team_1");
    expect(data.passwordHash).toBeUndefined();
  });

  it("refuses an email already belonging to a different account", async () => {
    // A cleaner login - re-pointing it at this team would be a takeover.
    dbMock.user.findUnique.mockResolvedValue({ id: "u9", role: "CLEANER", vaTeamId: null });

    await expect(
      inviteVaMember({ clientId: "client_1", teamId: "team_1", email: "x@test.com", invitedById: "user_1" })
    ).rejects.toThrow("EMAIL_IN_USE");

    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("refuses a VA who belongs to a DIFFERENT team", async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: "u9", role: "VA", vaTeamId: "team_other" });

    await expect(
      inviteVaMember({ clientId: "client_1", teamId: "team_1", email: "x@test.com", invitedById: "user_1" })
    ).rejects.toThrow("EMAIL_IN_USE");
  });

  it("treats a re-invite of an existing member as a resend", async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: "u_existing", role: "VA", vaTeamId: "team_1" });

    const result = await inviteVaMember({
      clientId: "client_1",
      teamId: "team_1",
      email: "x@test.com",
      invitedById: "user_1",
    });

    expect(dbMock.user.create).not.toHaveBeenCalled();
    expect(result.userId).toBe("u_existing");
  });

  it("reports a failed send rather than swallowing it", async () => {
    const { sendInvitationEmail } = await import("@/lib/auth/invitations");
    (sendInvitationEmail as any).mockResolvedValueOnce({ ok: false, error: "smtp_down" });
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.user.create.mockResolvedValue({ id: "user_va", email: "va@test.com", name: null });

    const result = await inviteVaMember({
      clientId: "client_1",
      teamId: "team_1",
      email: "va@test.com",
      invitedById: "user_1",
    });

    expect(result.emailSent).toBe(false);
    expect(result.emailError).toBe("smtp_down");
  });
});

describe("removeVaMember", () => {
  it("both detaches the team AND kills the credential", async () => {
    dbMock.vaTeam.findFirst.mockResolvedValue({ id: "team_1", clientId: "client_1", name: "T" });
    dbMock.user.findFirst.mockResolvedValue({ id: "user_va" });
    dbMock.user.update.mockResolvedValue({});

    await removeVaMember({ clientId: "client_1", teamId: "team_1", userId: "user_va" });

    // Detaching alone would leave a working login that resolves to no client;
    // deactivating alone would leave them attached if ever reactivated.
    expect(dbMock.user.update.mock.calls[0][0].data).toEqual({ isActive: false, vaTeamId: null });
  });

  it("refuses a user who is not on this team", async () => {
    dbMock.vaTeam.findFirst.mockResolvedValue({ id: "team_1", clientId: "client_1", name: "T" });
    dbMock.user.findFirst.mockResolvedValue(null);

    await expect(
      removeVaMember({ clientId: "client_1", teamId: "team_1", userId: "someone_else" })
    ).rejects.toThrow("MEMBER_NOT_FOUND");
  });
});

describe("deleteVaTeam", () => {
  it("deactivates the orphaned logins the SetNull relation would leave behind", async () => {
    dbMock.vaTeam.findFirst.mockResolvedValue({ id: "team_1", clientId: "client_1", name: "T" });

    await deleteVaTeam({ clientId: "client_1", teamId: "team_1" });

    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { vaTeamId: "team_1", role: "VA" },
      data: { isActive: false, vaTeamId: null },
    });
    expect(dbMock.vaTeam.delete).toHaveBeenCalled();
  });
});
