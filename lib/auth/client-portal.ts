/**
 * V1 — the ONE way to authorise a client-portal request.
 *
 * Two kinds of person reach the client portal: the CLIENT themselves, and a VA
 * acting on their behalf. Every route needs the same four answers — which
 * client, who is actually acting, what may they do, and which properties are in
 * scope — so they are answered once, here.
 *
 * WHY A CHOKEPOINT AND NOT `requireRole([Role.CLIENT, Role.VA])`.
 * Adding Role.VA to the ~36 existing role checks would compile and appear to
 * work, and would be wrong in a way nobody notices for months: each route would
 * then need its own permission check and its own property-scope filter, and the
 * 2026-08-15 audit found six different ways those routes already resolve a
 * client id (several of which quietly ignore per-client visibility overrides).
 * Adding a second actor to that is how a VA ends up seeing a property their
 * client never granted. One function, one set of rules.
 *
 * WHY THE ACTOR IS NOT SWAPPED.
 * Impersonation ("test as") swaps session.user to the target and lets
 * downstream code stay ignorant, which is safe there because the admin doing it
 * could already read everything the target can. A VA is the opposite: their
 * access is a SUBSET of the client's. Swapping identity would silently grant a
 * VA everything the client has. So the subject (`clientId`) and the actor
 * (`actor`, `userId`, `team`) are returned separately and both stay visible.
 *
 * FAILURE IS CLOSED. A VA with no team, an inactive team, a team whose client
 * has gone, or an unreadable permissions blob all resolve to no access — never
 * to the client's full access.
 */

import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { mergeClientPortalVisibility, sanitizeClientVisibilityOverride } from "@/lib/client/portal";
import {
  parseVaPermissions,
  parseVaPropertyScope,
  assertVaMayAct,
  hasVaPermission,
  type VaPermissionKey,
  type VaPermissions,
} from "@/lib/va/permissions";

export type ClientPortalActor = "CLIENT" | "VA";

export interface ClientPortalTeam {
  id: string;
  name: string;
}

export interface ClientPortalContext {
  /** The client whose data this request is about. Never the VA's own id. */
  clientId: string;
  /** Who is actually acting. */
  actor: ClientPortalActor;
  /** The acting user's own id — the VA's, not the client's. Audit uses this. */
  userId: string;
  /** Set only for a VA. */
  team: ClientPortalTeam | null;
  /** What this actor may do. A CLIENT is granted everything. */
  permissions: VaPermissions;
  /**
   * Property restriction. null means every property of the client — a CLIENT is
   * always null; a VA is null only when their team has no explicit scope.
   */
  propertyIds: string[] | null;
  /** Merged app + per-client portal visibility, as the old context returned. */
  visibility: AppSettings["clientPortalVisibility"];
  settings: AppSettings;
  /** Human-readable attribution for audit: "VA login (Team) on behalf of X". */
  actorLabel: string;
}

/** A CLIENT is not permission-limited; every key is granted. */
function fullPermissions(): VaPermissions {
  return {
    bookings: true,
    maintenance: true,
    reports: true,
    damage: true,
    invoicesView: true,
    messages: true,
    properties: true,
  };
}

/**
 * Authorise a client-portal request.
 *
 * Throws "UNAUTHORIZED" (not signed in), "FORBIDDEN" (wrong role, or a VA whose
 * grant does not resolve), or "CLIENT_PROFILE_MISSING" (a CLIENT user with no
 * client row — a data problem, not an access decision, and worth telling apart).
 */
export async function requireClientPortal(options?: {
  /** Require this capability; a VA without it is refused. */
  permission?: VaPermissionKey;
  /**
   * Also resolve the other Client rows sharing this user's email address.
   * Only the approvals routes need this — see `clientIds` on the result.
   */
  includeEmailMatchedClients?: boolean;
  settings?: AppSettings;
}): Promise<ClientPortalContext & { clientIds: string[] }> {
  const session = await requireSession();
  const role = session.user.role;

  if (role !== Role.CLIENT && role !== Role.VA) {
    throw new Error("FORBIDDEN");
  }

  const settings = options?.settings ?? (await getAppSettings());

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      clientId: true,
      vaTeamId: true,
      client: { select: { id: true, portalVisibilityOverrides: true } },
      vaTeam: {
        select: {
          id: true,
          name: true,
          isActive: true,
          permissions: true,
          propertyIds: true,
          clientId: true,
          client: { select: { id: true, name: true, portalVisibilityOverrides: true } },
        },
      },
    },
  });
  if (!user) throw new Error("UNAUTHORIZED");

  let clientId: string;
  let actor: ClientPortalActor;
  let team: ClientPortalTeam | null = null;
  let permissions: VaPermissions;
  let propertyIds: string[] | null = null;
  let overridesSource: unknown;
  let actorLabel: string;

  if (role === Role.VA) {
    const vaTeam = user.vaTeam;
    // No team, a deactivated team, or a team whose client is gone: no access.
    // Deliberately FORBIDDEN rather than falling back to user.clientId — a VA
    // login must never resolve to a client through any path but its team.
    if (!vaTeam || !vaTeam.isActive || !vaTeam.client) throw new Error("FORBIDDEN");

    actor = "VA";
    clientId = vaTeam.clientId;
    team = { id: vaTeam.id, name: vaTeam.name };
    permissions = parseVaPermissions(vaTeam.permissions);
    propertyIds = parseVaPropertyScope(vaTeam.propertyIds);
    overridesSource = vaTeam.client.portalVisibilityOverrides;
    actorLabel = `VA login (${vaTeam.name}) on behalf of ${vaTeam.client.name}`;
  } else {
    if (!user.clientId) throw new Error("CLIENT_PROFILE_MISSING");
    actor = "CLIENT";
    clientId = user.clientId;
    permissions = fullPermissions();
    overridesSource = user.client?.portalVisibilityOverrides;
    actorLabel = "Client";
  }

  if (options?.permission && !hasVaPermission(permissions, options.permission)) {
    throw new Error("FORBIDDEN");
  }

  const overrides = sanitizeClientVisibilityOverride(overridesSource);
  const visibility = mergeClientPortalVisibility(settings.clientPortalVisibility, overrides);

  // The approvals routes historically match on email across Client rows, so a
  // client user reaches approvals for every Client sharing their address.
  // Preserved rather than silently narrowed — but only for the CLIENT actor: a
  // VA's reach is defined by their team, and widening it by the VA's own email
  // would be an escalation.
  let clientIds = [clientId];
  if (options?.includeEmailMatchedClients && actor === "CLIENT" && user.email) {
    const matches = await db.client.findMany({
      where: { email: user.email },
      select: { id: true },
    });
    clientIds = Array.from(new Set([clientId, ...matches.map((m) => m.id)]));
  }

  return {
    clientId,
    clientIds,
    actor,
    userId: user.id,
    team,
    permissions,
    propertyIds,
    visibility,
    settings,
    actorLabel,
  };
}

/**
 * The portal scope for a user id, with no session involved.
 *
 * `lib/client/portal-data.ts` resolves a client from a bare userId (the pages
 * call it that way), and every one of its queries filters on that clientId. If
 * that resolver stayed VA-blind, a VA would either see nothing or — worse, once
 * it learned about teams — see their client's ENTIRE portfolio regardless of
 * the property scope the client granted. Returning the scope alongside the
 * client id is what stops the second case: the filter lives with the lookup, so
 * a query cannot use one without the other.
 *
 * Returns null when the user resolves to no client at all.
 */
export async function resolvePortalScopeForUser(
  userId: string
): Promise<{ clientId: string; propertyIds: string[] | null } | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      clientId: true,
      vaTeam: {
        select: { isActive: true, clientId: true, propertyIds: true },
      },
    },
  });
  if (!user) return null;

  if (user.role === Role.VA) {
    const team = user.vaTeam;
    // Same fail-closed rule as requireClientPortal: never fall back to
    // user.clientId for a VA.
    if (!team || !team.isActive) return null;
    return { clientId: team.clientId, propertyIds: parseVaPropertyScope(team.propertyIds) };
  }

  return user.clientId ? { clientId: user.clientId, propertyIds: null } : null;
}

/**
 * Narrow a Prisma `where` on properties to the actor's scope.
 *
 * Returns the clause to spread into a query. A CLIENT (or an unrestricted VA
 * team) gets the client filter alone; a scoped VA additionally gets an id
 * filter. Centralised so no route has to remember the VA case exists.
 */
export function propertyScopeWhere(ctx: Pick<ClientPortalContext, "clientId" | "propertyIds">) {
  return ctx.propertyIds
    ? { clientId: ctx.clientId, id: { in: ctx.propertyIds } }
    : { clientId: ctx.clientId };
}

/** The same scope expressed for a relation named `property`. */
export function nestedPropertyScopeWhere(
  ctx: Pick<ClientPortalContext, "clientId" | "propertyIds">
) {
  return { property: propertyScopeWhere(ctx) };
}

/** Re-exported so routes assert money rules from the same import. */
export { assertVaMayAct };

/**
 * Record a portal action against the person who actually performed it.
 *
 * `AuditLog.userId` is a single actor column with no subject field, so a VA's
 * action would otherwise be indistinguishable from the client's own. The real
 * acting user goes in `userId` (matching how impersonation audits the admin,
 * not the target), and the delegation is carried in `after` alongside a
 * human-readable label.
 */
export async function auditClientPortalAction(input: {
  ctx: ClientPortalContext;
  action: string;
  entity: string;
  entityId: string;
  after?: Record<string, unknown>;
}) {
  return db.auditLog.create({
    data: {
      userId: input.ctx.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      after: {
        ...(input.after ?? {}),
        actor: input.ctx.actor,
        actorLabel: input.ctx.actorLabel,
        onBehalfOfClientId: input.ctx.clientId,
        vaTeamId: input.ctx.team?.id ?? null,
        vaTeamName: input.ctx.team?.name ?? null,
      } as object,
    },
  });
}
