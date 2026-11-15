import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { heldRoles } from "@/lib/auth/roles";
import { getOpsAccess } from "@/lib/rbac/ops-access";

/**
 * Who may do what in the social post generator (2026-11-17; owner defaults
 * pending confirmation). Always read live from the database, never from a
 * cached token or the browser:
 *
 * - create drafts and post (or plan a post): ADMIN, or OPS_MANAGER with
 *   Marketing at Manage (routes under /api/admin/marketing are also held to
 *   the Marketing pack by the shared request guard);
 * - record or revoke a marketing permission: ADMIN, or OPS_MANAGER with
 *   Clients and Marketing at Manage (the client may give or take back their
 *   own in the portal);
 * - connect, disconnect, replace the Meta app secret: ADMIN only, with their
 *   own PIN, never while testing as someone.
 *
 * Posting and connecting are refused while testing as someone (the actual
 * person must be at the keyboard); a planned post re-checks the person who
 * planned it at the time it runs.
 */

export type SocialRight = "post" | "consent";

/** Null when this user may do it now; otherwise the reason in words. */
export async function socialRightRefusal(userId: string, right: SocialRight): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, role: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive) return "This account is not active.";
  const roles = heldRoles(user.role, user.extraRoles.map((row) => row.role));
  if (roles.includes(Role.ADMIN)) return null;
  if (!roles.includes(Role.OPS_MANAGER)) return "Only administrators and operations managers with the Marketing pack can do this.";
  const levels = await getOpsAccess({ id: user.id, role: String(user.role), heldRoles: roles.map(String) });
  if (!levels) return null;
  if (levels.marketing !== "manage") return "This needs Marketing set to Manage in your access.";
  if (right === "consent" && levels.clients !== "manage") return "Recording a marketing permission needs Clients and Marketing set to Manage in your access.";
  return null;
}

type RouteSession = { user: { id: string }; impersonation?: unknown };

/** The refusal for an outbound action (posting, connecting) while testing as someone. */
export function testingAsRefusal(session: RouteSession): string | null {
  return session.impersonation ? "Stop testing as someone else to do this: posting and connecting accounts use your own identity." : null;
}
