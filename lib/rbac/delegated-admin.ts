import "server-only";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { getOpsPolicy } from "./ops-access";
import { accessWithin, evaluateCapability, isAdministrator, type AccessSubject } from "./access-evaluator";
import { capabilityDefinition, type CapabilityKey } from "./capabilities";
import { sessionSubject } from "./can";
import type { OpsPolicy } from "./ops-policy";

/**
 * Administrator capabilities used by a non-administrator (owner decision
 * 2026-11-12). Every guardrail is checked here, on the server, at the
 * enforcement point, after the route's live session/role guard:
 *   (e) never while testing as someone (the effective identity is not the
 *       person at the keyboard);
 *   the actor holds the capability (an ADMIN-made per-person grant);
 *   (a)/(d) the target is not an administrator and does not have more access
 *       than the actor; never the actor themselves.
 * Administrators keep these by rule. The caller still runs the action's PIN
 * check and records the audit row against the actual actor.
 */
export class DelegatedActionDenied extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export type DelegatedActor = { id: string; role: "ADMIN" | "OPS_MANAGER" };

/** Live roles of an account (primary plus extras); null when missing or inactive. */
export async function loadAccessSubject(userId: string): Promise<AccessSubject | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, extraRoles: { select: { role: true } } },
  });
  if (!user?.isActive) return null;
  return { id: user.id, role: String(user.role), heldRoles: [String(user.role), ...(user.extraRoles ?? []).map((row) => String(row.role))] };
}

/** Pure decision, shared by the routes, the impersonation re-check and the tests. */
export function delegatedDecision(
  policy: OpsPolicy,
  actor: AccessSubject,
  key: CapabilityKey,
  target: AccessSubject | null | undefined,
  impersonating: boolean,
): { allowed: true } | { allowed: false; reason: string } {
  if (impersonating) return { allowed: false, reason: "This cannot be done while testing as someone else." };
  if (!isAdministrator(actor) && !evaluateCapability(policy, actor, key)) {
    return { allowed: false, reason: `Your access does not include: ${capabilityDefinition(key).label}.` };
  }
  if (target === null) return { allowed: false, reason: "That account no longer exists or is deactivated." };
  if (target && !isAdministrator(actor)) {
    if (target.id === actor.id) return { allowed: false, reason: "You cannot do this to your own account." };
    if (isAdministrator(target)) return { allowed: false, reason: "Only an administrator can do this to an administrator." };
    if (!accessWithin(policy, target, actor)) return { allowed: false, reason: "This person has more access than you." };
  }
  return { allowed: true };
}

export async function requireDelegatedAction(session: Session, key: CapabilityKey, targetId?: string): Promise<DelegatedActor> {
  const actor = sessionSubject(session);
  const administrator = isAdministrator(actor) && !session.impersonation;
  // Administrators never read a pack; everyone else reads the live policy.
  const policy = administrator ? null : await getOpsPolicy();
  const target = targetId === undefined ? undefined : await loadAccessSubject(targetId);
  if (target === null && !administrator) throw new DelegatedActionDenied("That account no longer exists or is deactivated.", 404);
  if (!administrator) {
    const decision = delegatedDecision(policy as OpsPolicy, actor, key, target, Boolean(session.impersonation));
    if (!decision.allowed) throw new DelegatedActionDenied(decision.reason);
  }
  return { id: actor.id, role: administrator ? "ADMIN" : "OPS_MANAGER" };
}

/** Test as, re-checked on every request for a non-administrator actor. */
export async function delegatedTestAsAllowed(actorId: string, targetId: string): Promise<boolean> {
  const [actor, target] = await Promise.all([loadAccessSubject(actorId), loadAccessSubject(targetId)]);
  if (!actor || !target) return false;
  if (isAdministrator(actor)) return !isAdministrator(target);
  return delegatedDecision(await getOpsPolicy(), actor, "access.test_as", target, false).allowed;
}

/**
 * For routes that authorise the REAL signed-in person (requireRealSession,
 * e.g. Test as): does this account hold the capability right now? Reads the
 * live roles, so a revoked role or grant applies at once.
 */
export async function realActorHolds(actorId: string, key: CapabilityKey): Promise<boolean> {
  const actor = await loadAccessSubject(actorId);
  if (!actor) return false;
  if (isAdministrator(actor)) return true;
  return evaluateCapability(await getOpsPolicy(), actor, key);
}
