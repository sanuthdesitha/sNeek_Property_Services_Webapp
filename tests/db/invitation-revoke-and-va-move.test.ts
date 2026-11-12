// @vitest-environment node
/**
 * Owner decisions 2026-11-13 on a real disposable PostgreSQL (127.0.0.1:55439):
 *
 * 2. Invitations are revocable — a revoked link is refused by the accept API
 *    and page with its own "withdrawn" state (not expired/used/invalid), a
 *    revoke never marks an accepted invitation, a revoke and an accept racing
 *    each other leave exactly one outcome, the role rule (never upward)
 *    holds, and a resend after a revoke issues a fresh, working invitation.
 * 3. Moving an assistant between teams of the same client — one transaction,
 *    cross-client refused, a switched-off destination refused unless
 *    confirmed, access follows the new team on the next read, audited with the
 *    before and after team.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Role } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
// The auth-state store is a fixture-wide setting; it is not what these tests are about.
vi.mock("@/lib/auth/account-state", () => ({ upsertAuthUserState: vi.fn(async () => ({})) }));

import { createUserInvitation } from "@/lib/auth/invitations";
import { invitationLinkState } from "@/lib/auth/invitation-state";
import { revokeInvitation, revokeInvitations } from "@/lib/accounts/invitation-revoke";
import { AccountEmailError, type AccountEmailActor } from "@/lib/accounts/account-emails";
import { GET as acceptGet, POST as acceptPost } from "@/app/api/auth/accept-invite/[token]/route";
import { moveVaMember, VaMoveRefused } from "@/lib/va/move-member";
import { resolvePortalScopeForUser } from "@/lib/auth/client-portal";
import { VA_PERMISSION_KEYS } from "@/lib/va/permissions";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `d5-${randomUUID().slice(0, 8)}`;
const ids = {
  admin: randomUUID(), ops: randomUUID(), invitedAdmin: randomUUID(), va: randomUUID(), va2: randomUUID(),
  clientA: randomUUID(), clientB: randomUUID(), propA1: randomUUID(), propA2: randomUUID(), propB1: randomUUID(),
  teamA1: randomUUID(), teamA2: randomUUID(), teamAOff: randomUUID(), teamB: randomUUID(),
};
const admin: AccountEmailActor = { id: ids.admin, role: "ADMIN", heldRoles: ["ADMIN"] };
const ops: AccountEmailActor = { id: ids.ops, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };

function permissions(keys: string[]): Prisma.InputJsonValue {
  return Object.fromEntries(VA_PERMISSION_KEYS.map((key) => [key, keys.includes(key)]));
}

async function tokenOf(userId: string): Promise<string> {
  return (await m.client.userInvitation.findUniqueOrThrow({ where: { userId } })).token;
}

const getInvite = (token: string) => acceptGet(new NextRequest(`http://local/api/auth/accept-invite/${token}`), { params: { token } });
const postInvite = (token: string) =>
  acceptPost(new NextRequest(`http://local/api/auth/accept-invite/${token}`, { method: "POST", body: JSON.stringify({ password: "a long password" }) }), { params: { token } });

describe.skipIf(!url)("invitation revoke and assistant team moves (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [
      { id: ids.admin, email: `${tag}-admin@example.invalid`, role: Role.ADMIN },
      { id: ids.ops, email: `${tag}-ops@example.invalid`, role: Role.OPS_MANAGER },
      { id: ids.invitedAdmin, email: `${tag}-newadmin@example.invalid`, role: Role.ADMIN },
    ] });
    await m.client.client.createMany({ data: [{ id: ids.clientA, name: `${tag} A` }, { id: ids.clientB, name: `${tag} B` }] });
    await m.client.property.createMany({ data: [
      { id: ids.propA1, clientId: ids.clientA, name: "Harbour", address: "1 St", suburb: "Town" },
      { id: ids.propA2, clientId: ids.clientA, name: "Hill", address: "2 St", suburb: "Town" },
      { id: ids.propB1, clientId: ids.clientB, name: "Other", address: "3 St", suburb: "Town" },
    ] });
    await m.client.vaTeam.createMany({ data: [
      { id: ids.teamA1, clientId: ids.clientA, name: "Bookings", createdById: ids.admin, permissions: permissions(["bookings", "reports"]), propertyIds: [ids.propA1] },
      { id: ids.teamA2, clientId: ids.clientA, name: "Maintenance", createdById: ids.admin, permissions: permissions(["maintenance", "reports"]), propertyIds: Prisma.DbNull },
      { id: ids.teamAOff, clientId: ids.clientA, name: "Paused", createdById: ids.admin, permissions: permissions([]), isActive: false },
      { id: ids.teamB, clientId: ids.clientB, name: "Other client", createdById: ids.admin, permissions: permissions(["bookings"]) },
    ] });
    await m.client.user.createMany({ data: [
      { id: ids.va, email: `${tag}-va@example.invalid`, role: Role.VA, vaTeamId: ids.teamA1 },
      { id: ids.va2, email: `${tag}-va2@example.invalid`, role: Role.VA, vaTeamId: ids.teamA1 },
    ] });
  });

  afterAll(async () => {
    if (!m.client) return;
    const users = [ids.admin, ids.ops, ids.invitedAdmin, ids.va, ids.va2];
    await m.client.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { entityId: { in: users } }] } });
    await m.client.userInvitation.deleteMany({ where: { userId: { in: users } } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.va, ids.va2] } } });
    await m.client.vaTeam.deleteMany({ where: { clientId: { in: [ids.clientA, ids.clientB] } } });
    await m.client.property.deleteMany({ where: { clientId: { in: [ids.clientA, ids.clientB] } } });
    await m.client.client.deleteMany({ where: { id: { in: [ids.clientA, ids.clientB] } } });
    await m.client.user.deleteMany({ where: { id: { in: users } } });
    await m.client.$disconnect();
  });

  it("a revoked link is refused with its own withdrawn state, and audited with the actor", async () => {
    await createUserInvitation({ userId: ids.va, createdById: ids.admin });
    const token = await tokenOf(ids.va);
    expect((await getInvite(token)).status).toBe(200);
    await revokeInvitation(ops, ids.va);
    const row = await m.client.userInvitation.findUniqueOrThrow({ where: { userId: ids.va }, include: { user: { select: { isActive: true } } } });
    expect(row.revokedById).toBe(ids.ops);
    expect(invitationLinkState(row)).toBe("revoked");
    const get = await getInvite(token);
    expect(get.status).toBe(410);
    expect(await get.json()).toEqual({ error: "This invitation was withdrawn. Ask the office for a new one.", code: "REVOKED" });
    const post = await postInvite(token);
    expect(post.status).toBe(410);
    expect((await m.client.user.findUniqueOrThrow({ where: { id: ids.va } })).passwordHash).toBeNull();
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { action: "ACCOUNT_INVITATION_REVOKED", entityId: ids.va } });
    expect(audit.userId).toBe(ids.ops);
    expect(audit.after).toMatchObject({ actorRole: "OPS_MANAGER" });
    expect(JSON.stringify(audit.after)).not.toContain(token);
    // A second revoke is a clear refusal, not a second record.
    await expect(revokeInvitation(admin, ids.va)).rejects.toMatchObject({ status: 409, message: "The invitation was already withdrawn." });
  });

  it("a resend after a revoke issues a fresh invitation that works; the old link stays dead", async () => {
    const old = await tokenOf(ids.va);
    await createUserInvitation({ userId: ids.va, createdById: ids.admin });
    const fresh = await tokenOf(ids.va);
    expect(fresh).not.toBe(old);
    expect((await getInvite(old)).status).toBe(404);
    expect((await getInvite(fresh)).status).toBe(200);
    expect((await m.client.userInvitation.findUniqueOrThrow({ where: { userId: ids.va } })).revokedAt).toBeNull();
    expect((await postInvite(fresh)).status).toBe(200);
    await expect(revokeInvitation(admin, ids.va)).rejects.toMatchObject({ status: 409, message: "The invitation was already accepted." });
    expect((await m.client.userInvitation.findUniqueOrThrow({ where: { userId: ids.va } })).revokedAt).toBeNull();
  });

  it("never upward: an operations manager cannot revoke an administrator's invitation; an administrator can", async () => {
    await createUserInvitation({ userId: ids.invitedAdmin, createdById: ids.admin });
    const refused = await revokeInvitation(ops, ids.invitedAdmin).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AccountEmailError);
    expect(refused).toMatchObject({ status: 403 });
    await expect(revokeInvitation(admin, ids.invitedAdmin)).resolves.toMatchObject({ userId: ids.invitedAdmin });
    const bulk = await revokeInvitations(admin, [ids.invitedAdmin, ids.va]);
    expect(bulk.map((row) => row.outcome)).toEqual(["refused", "refused"]);
  });

  it("a revoke racing an accept leaves exactly one outcome", async () => {
    await createUserInvitation({ userId: ids.va2, createdById: ids.admin });
    const token = await tokenOf(ids.va2);
    const [accepted, revoked] = await Promise.allSettled([postInvite(token), revokeInvitation(admin, ids.va2)]);
    const row = await m.client.userInvitation.findUniqueOrThrow({ where: { userId: ids.va2 } });
    const user = await m.client.user.findUniqueOrThrow({ where: { id: ids.va2 } });
    const acceptWon = accepted.status === "fulfilled" && accepted.value.status === 200;
    const revokeWon = revoked.status === "fulfilled";
    expect(acceptWon !== revokeWon).toBe(true);
    expect(Boolean(row.acceptedAt)).toBe(acceptWon);
    expect(Boolean(row.revokedAt)).toBe(revokeWon);
    expect(Boolean(user.passwordHash)).toBe(acceptWon);
  });

  it("moves an assistant between teams of the same client; access follows the new team on the next read; audited", async () => {
    expect(await resolvePortalScopeForUser(ids.va)).toEqual({ clientId: ids.clientA, propertyIds: [ids.propA1] });
    const result = await moveVaMember({ userId: ids.va, toTeamId: ids.teamA2, confirmInactive: false, actor: { id: ids.admin, role: "ADMIN", impersonatedBy: null } });
    expect(result).toMatchObject({ from: { id: ids.teamA1 }, to: { id: ids.teamA2 }, loses: ["Bookings"], gains: ["Maintenance"] });
    expect(result.scope).toBe("Properties: from Harbour to every property of the client.");
    expect((await m.client.user.findUniqueOrThrow({ where: { id: ids.va } })).vaTeamId).toBe(ids.teamA2);
    // The next request reads the new team's scope (nothing cached).
    expect(await resolvePortalScopeForUser(ids.va)).toEqual({ clientId: ids.clientA, propertyIds: null });
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { action: "MOVE_VA_MEMBER", entityId: ids.va } });
    expect(audit.userId).toBe(ids.admin);
    expect(audit.before).toMatchObject({ teamId: ids.teamA1, teamName: "Bookings", propertyIds: [ids.propA1] });
    expect(audit.after).toMatchObject({ teamId: ids.teamA2, teamName: "Maintenance", actorRole: "ADMIN", impersonatedBy: null });
  });

  it("refuses a cross-client move and the same team, and a switched-off team unless confirmed", async () => {
    const actor = { id: ids.admin, role: "ADMIN", impersonatedBy: null };
    await expect(moveVaMember({ userId: ids.va, toTeamId: ids.teamB, confirmInactive: true, actor })).rejects.toMatchObject({ code: "CROSS_CLIENT" });
    await expect(moveVaMember({ userId: ids.va, toTeamId: ids.teamA2, confirmInactive: false, actor })).rejects.toBeInstanceOf(VaMoveRefused);
    await expect(moveVaMember({ userId: ids.va, toTeamId: ids.teamAOff, confirmInactive: false, actor })).rejects.toMatchObject({ code: "DESTINATION_INACTIVE" });
    expect((await m.client.user.findUniqueOrThrow({ where: { id: ids.va } })).vaTeamId).toBe(ids.teamA2);
    await moveVaMember({ userId: ids.va, toTeamId: ids.teamAOff, confirmInactive: true, actor });
    // A switched-off team resolves to no access at all, from the next read.
    expect(await resolvePortalScopeForUser(ids.va)).toBeNull();
    await expect(moveVaMember({ userId: ids.ops, toTeamId: ids.teamA1, confirmInactive: false, actor })).rejects.toThrow("MEMBER_NOT_FOUND");
  });
});
