/**
 * V2 — creating and managing VA teams.
 *
 * V1 built the chokepoint that decides what a VA may do
 * (`lib/auth/client-portal.ts`) and the permission contract it reads
 * (`lib/va/permissions.ts`). Neither could ever be exercised, because nothing
 * in the product could create a team, attach a login to it, or set its grants.
 * This module is that missing half.
 *
 * MANAGING A TEAM IS NOT A PERMISSION — IT IS NOT DELEGABLE AT ALL.
 * There is deliberately no "team" key in VA_PERMISSION_KEYS, and this module
 * refuses any VA actor outright via `assertTeamManager`. The reasoning is the
 * money rule's, one step further: the money rule stops a VA approving a spend,
 * but a VA who could edit their own team's permissions could simply grant
 * themselves the keys and then approve it. Delegation must not be able to widen
 * itself, so the check is on the ACTOR, not on a grant a blob could carry.
 *
 * PROPERTY SCOPE IS VALIDATED AGAINST OWNERSHIP, NOT TRUSTED.
 * `VaTeam.propertyIds` is a Json filter with no foreign key, so nothing in the
 * database stops a client posting another client's property id and scoping a VA
 * onto it. Every write here checks the ids belong to the acting client and
 * REJECTS unknown ones rather than quietly dropping them — a scope that silently
 * shrinks is a client believing their VA can see something they cannot.
 */

import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { vaPermissionsInputSchema, emptyVaPermissions } from "@/lib/va/permissions";
import type { ClientPortalContext } from "@/lib/auth/client-portal";
import { createUserInvitation, buildInvitationUrl, sendInvitationEmail } from "@/lib/auth/invitations";

/** Longest a team name may be. Names are labels in an audit trail, not prose. */
const TEAM_NAME_MAX = 80;

export const vaTeamCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the team a name.").max(TEAM_NAME_MAX),
  permissions: vaPermissionsInputSchema.optional(),
  propertyIds: z.array(z.string().trim().min(1)).optional(),
});

export const vaTeamUpdateSchema = z.object({
  name: z.string().trim().min(1).max(TEAM_NAME_MAX).optional(),
  permissions: vaPermissionsInputSchema.optional(),
  /** An empty array clears the scope, meaning "every property this client owns". */
  propertyIds: z.array(z.string().trim().min(1)).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const vaMemberInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z.string().trim().max(120).optional(),
});

/**
 * Only the client themselves may manage teams — never a VA.
 *
 * See the module header: a VA who could edit their own team could grant
 * themselves anything, which would make every other permission check
 * decorative.
 */
export function assertTeamManager(ctx: Pick<ClientPortalContext, "actor">): void {
  if (ctx.actor !== "CLIENT") throw new Error("FORBIDDEN");
}

/**
 * Narrow a set of property ids to the ones this client actually owns.
 * Throws on any id that is not theirs rather than dropping it silently.
 */
async function assertPropertiesOwned(clientId: string, propertyIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(propertyIds.map((id) => id.trim()).filter(Boolean)));
  if (unique.length === 0) return [];

  const owned = await db.property.findMany({
    where: { clientId, id: { in: unique } },
    select: { id: true },
  });
  if (owned.length !== unique.length) {
    throw new Error("PROPERTY_NOT_FOUND");
  }
  return unique;
}

/** Load a team, asserting it belongs to this client. */
async function requireOwnedTeam(clientId: string, teamId: string) {
  const team = await db.vaTeam.findFirst({
    where: { id: teamId, clientId },
    select: { id: true, clientId: true, name: true },
  });
  if (!team) throw new Error("TEAM_NOT_FOUND");
  return team;
}

const TEAM_SELECT = {
  id: true,
  name: true,
  isActive: true,
  permissions: true,
  propertyIds: true,
  createdAt: true,
  members: {
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      invitation: { select: { acceptedAt: true, expiresAt: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

export async function listVaTeams(clientId: string) {
  return db.vaTeam.findMany({
    where: { clientId },
    select: TEAM_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

export async function createVaTeam(input: {
  clientId: string;
  createdById: string;
  name: string;
  permissions?: Record<string, boolean>;
  propertyIds?: string[];
}) {
  const scope = input.propertyIds ? await assertPropertiesOwned(input.clientId, input.propertyIds) : [];

  return db.vaTeam.create({
    data: {
      clientId: input.clientId,
      createdById: input.createdById,
      name: input.name,
      // A team created without explicit grants starts with nothing, matching
      // parseVaPermissions' rule that an unreadable grant is no access.
      permissions: (input.permissions ?? emptyVaPermissions()) as Prisma.InputJsonValue,
      propertyIds: scope.length > 0 ? (scope as Prisma.InputJsonValue) : Prisma.DbNull,
    },
    select: TEAM_SELECT,
  });
}

export async function updateVaTeam(input: {
  clientId: string;
  teamId: string;
  name?: string;
  permissions?: Record<string, boolean>;
  propertyIds?: string[] | null;
  isActive?: boolean;
}) {
  await requireOwnedTeam(input.clientId, input.teamId);

  // Typed as the Prisma input rather than a loose record: clearing a nullable
  // Json column needs Prisma.DbNull, and a bare null is a RUNTIME error Prisma
  // raises but a Record<string, unknown> would happily accept.
  const data: Prisma.VaTeamUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.permissions !== undefined) data.permissions = input.permissions as Prisma.InputJsonValue;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.propertyIds !== undefined) {
    if (input.propertyIds === null || input.propertyIds.length === 0) {
      data.propertyIds = Prisma.DbNull;
    } else {
      data.propertyIds = (await assertPropertiesOwned(
        input.clientId,
        input.propertyIds
      )) as Prisma.InputJsonValue;
    }
  }

  return db.vaTeam.update({
    where: { id: input.teamId },
    data,
    select: TEAM_SELECT,
  });
}

export async function deleteVaTeam(input: { clientId: string; teamId: string }) {
  await requireOwnedTeam(input.clientId, input.teamId);

  // The VaTeamMembers relation is onDelete: SetNull, so deleting the team
  // leaves its logins orphaned rather than removed. requireClientPortal already
  // refuses a VA with no team, but an orphaned row is still a credential that
  // can sign in, so deactivate the logins in the same transaction.
  return db.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { vaTeamId: input.teamId, role: Role.VA },
      data: { isActive: false, vaTeamId: null },
    });
    await tx.vaTeam.delete({ where: { id: input.teamId } });
  });
}

/**
 * Invite a VA login onto a team.
 *
 * The account is created immediately but with NO password hash, and
 * `auth-options` refuses any credentials login without one — so the row is
 * inert until the person accepts the invitation and sets a password. That is
 * why the generic invitation flow (`lib/auth/invitations.ts`) needs no VA
 * special case: it already creates the token, and `/accept-invite/[token]`
 * already reads the role off the user rather than deciding it.
 */
export async function inviteVaMember(input: {
  clientId: string;
  teamId: string;
  email: string;
  name?: string;
  invitedById: string;
}) {
  const team = await requireOwnedTeam(input.clientId, input.teamId);

  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, role: true, vaTeamId: true },
  });

  // Re-inviting someone already on this team is a resend, not an error — the
  // first email is the one that most often gets lost. Any OTHER existing
  // account (a cleaner, a client, a VA of a different client) is refused:
  // re-pointing a live login at this team would be an account takeover.
  if (existing) {
    if (existing.role !== Role.VA || existing.vaTeamId !== team.id) {
      throw new Error("EMAIL_IN_USE");
    }
    return issueVaInvitation({ userId: existing.id, email: input.email, name: input.name ?? null, invitedById: input.invitedById });
  }

  const user = await db.user.create({
    data: {
      email: input.email,
      name: input.name?.trim() || null,
      role: Role.VA,
      vaTeamId: team.id,
      isActive: true,
    },
    select: { id: true, email: true, name: true },
  });

  return issueVaInvitation({ userId: user.id, email: user.email, name: user.name, invitedById: input.invitedById });
}

async function issueVaInvitation(input: {
  userId: string;
  email: string;
  name: string | null;
  invitedById: string;
}) {
  const { token, expiresAt } = await createUserInvitation({
    userId: input.userId,
    createdById: input.invitedById,
  });

  const sent = await sendInvitationEmail({
    to: input.email,
    name: input.name,
    role: Role.VA,
    url: buildInvitationUrl(token),
    expiresAt,
  });

  // The invitation row is valid whether or not the email left the building, so
  // the caller is told rather than the failure being swallowed — the client can
  // then resend or pass the link on themselves.
  return { userId: input.userId, email: input.email, expiresAt, emailSent: sent.ok, emailError: sent.error };
}

/**
 * Remove a VA login from a team.
 *
 * Both halves matter. Clearing `vaTeamId` makes `requireClientPortal` fail
 * closed for them, and `isActive: false` stops the credential signing in at
 * all — without the second, a removed assistant still holds a working login
 * that merely resolves to no client.
 */
export async function removeVaMember(input: { clientId: string; teamId: string; userId: string }) {
  await requireOwnedTeam(input.clientId, input.teamId);

  const member = await db.user.findFirst({
    where: { id: input.userId, vaTeamId: input.teamId, role: Role.VA },
    select: { id: true },
  });
  if (!member) throw new Error("MEMBER_NOT_FOUND");

  await db.user.update({
    where: { id: member.id },
    data: { isActive: false, vaTeamId: null },
  });

  return { removed: member.id };
}
