import "server-only";
import type { Session } from "next-auth";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { isAdministrator } from "@/lib/rbac/access-evaluator";
import { isOpsSubject } from "@/lib/rbac/ops-policy";

/**
 * Who may edit notification wording, regenerate a proposal, restore a version
 * or send a wording test to themselves (owner decision 2026-11-12): any
 * administrator, or an operations manager whose notifications
 * (communications) pack is at Manage. Never while impersonating. Called after
 * the route's live `requireRole([ADMIN, OPS_MANAGER])` guard, on the effective
 * session (an impersonated target never passes: impersonation is refused).
 *
 * The on/off switches and per-type controls stay ADMIN only (unchanged).
 */
export type WordingEditDecision = { allowed: true; actorRole: "ADMIN" | "OPS_MANAGER" } | { allowed: false; reason: string };

export async function wordingEditDecision(session: Session): Promise<WordingEditDecision> {
  if (session.impersonation) return { allowed: false, reason: "Wording cannot be changed while impersonating." };
  const subject = { id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) };
  if (isAdministrator(subject)) return { allowed: true, actorRole: "ADMIN" };
  if (!isOpsSubject(subject)) return { allowed: false, reason: "Only administrators and operations managers can change wording." };
  const levels = await getOpsAccess(subject);
  if (levels?.communications !== "manage") return { allowed: false, reason: "Your access to Notifications is view only. Ask an administrator for Manage access to change wording." };
  return { allowed: true, actorRole: "OPS_MANAGER" };
}

export class WordingForbiddenError extends Error {
  readonly status = 403;
}

export async function requireWordingEditor(session: Session): Promise<"ADMIN" | "OPS_MANAGER"> {
  const decision = await wordingEditDecision(session);
  if (!decision.allowed) throw new WordingForbiddenError(decision.reason);
  return decision.actorRole;
}
