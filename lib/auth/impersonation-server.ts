import "server-only";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  IMPERSONATION_COOKIE,
  readImpersonationTicket,
  type ImpersonationMode,
  type ImpersonationTicket,
} from "./impersonation";

/**
 * Admin "test as" impersonation — the database-verified half.
 *
 * A valid signature is NOT sufficient authority. The ticket is re-checked
 * against live rows on every request, because everything it asserts can go
 * stale while it sits in the browser: the admin can be demoted or deactivated,
 * the target can be deleted or deactivated. A cookie minted an hour ago must
 * not outlive the permission that justified it.
 */

export type ActiveImpersonation = {
  ticket: ImpersonationTicket;
  actor: { id: string; name: string | null; email: string | null };
  target: { id: string; name: string | null; email: string | null; role: Role };
  mode: ImpersonationMode;
};

/**
 * Resolves the impersonation in effect for `realUserId` (the genuinely
 * signed-in user), or null.
 *
 * Refuses unless ALL of these hold right now:
 *   1. the ticket is signed by us and unexpired,
 *   2. the ticket was issued TO this session (actorId matches) — so a leaked
 *      cookie is useless in anyone else's browser,
 *   3. the actor is still an active ADMIN — demotion revokes instantly,
 *   4. the target still exists, is active, and is not an admin.
 *
 * Rule 4 is the one that stops privilege escalation: OPS_MANAGER never gets in
 * (rule 3), and no one can use this to become a *different* admin, so it can
 * only ever move sideways or down. Nothing here can gain permission the acting
 * admin didn't already have.
 */
export async function resolveImpersonation(
  realUserId: string,
): Promise<ActiveImpersonation | null> {
  let raw: string | undefined;
  try {
    raw = cookies().get(IMPERSONATION_COOKIE)?.value;
  } catch {
    // Outside a request scope (e.g. a scheduled job importing this module).
    return null;
  }
  const ticket = await readImpersonationTicket(raw);
  if (!ticket) return null;
  if (ticket.actorId !== realUserId) return null;

  const [actor, target] = await Promise.all([
    db.user.findUnique({
      where: { id: ticket.actorId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    }),
    db.user.findUnique({
      where: { id: ticket.targetId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    }),
  ]);

  if (!actor?.isActive || actor.role !== Role.ADMIN) return null;
  if (!target?.isActive) return null;
  if (target.role === Role.ADMIN) return null;

  return {
    ticket,
    actor: { id: actor.id, name: actor.name, email: actor.email },
    // The LIVE role, not the role recorded in the ticket — if someone changed
    // the target's role mid-session, the portal must follow the real one.
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
    mode: ticket.mode,
  };
}
