import "server-only";
/**
 * Who may do what with email designs and the Email look (owner defaults
 * 2026-11-16, pending confirmation):
 * - read: ADMIN and OPS_MANAGER (the notifications area; the middleware checks
 *   the communications pack, the route re-checks the role);
 * - edit drafts, restore or reset into a draft, send a test to yourself:
 *   any administrator, or an operations manager whose notifications
 *   (communications) pack is at Manage (the wording layer's rule); never while
 *   impersonating;
 * - publish an email or the Email look, and edit the Email look: ADMIN only,
 *   never while impersonating, with the person's own PIN in the same request
 *   (the route calls routeSecurityRefusal → verifySensitiveAction). An
 *   operations manager is never treated as an administrator here.
 */
import type { Session } from "next-auth";
import { isAdministrator } from "@/lib/rbac/access-evaluator";
import { wordingEditDecision } from "@/lib/notifications/wording/permission";

export type DesignAccess = {
  canDraft: boolean;
  draftReason: string | null;
  canPublish: boolean;
  publishReason: string | null;
  actorRole: "ADMIN" | "OPS_MANAGER" | null;
};

function subjectOf(session: Session) {
  return { id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) };
}

export function publishRefusal(session: Session): string | null {
  if (session.impersonation) return "Publishing is not available while testing as someone else.";
  if (!isAdministrator(subjectOf(session))) return "Only an administrator can publish. You can save a draft and send yourself a test.";
  return null;
}

export async function designAccess(session: Session): Promise<DesignAccess> {
  const decision = await wordingEditDecision(session);
  const publish = publishRefusal(session);
  return {
    canDraft: decision.allowed,
    draftReason: decision.allowed ? null : decision.reason.replace("Wording cannot be changed", "Email designs cannot be changed").replace("to change wording", "to edit email drafts"),
    canPublish: publish === null,
    publishReason: publish,
    actorRole: decision.allowed ? decision.actorRole : null,
  };
}

/** The Email look is administrator-only for drafts too (it changes every email at once). */
export function lookEditRefusal(session: Session): string | null {
  if (session.impersonation) return "The Email look cannot be changed while testing as someone else.";
  if (!isAdministrator(subjectOf(session))) return "Only an administrator can change the Email look.";
  return null;
}
