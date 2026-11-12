import "server-only";
import { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { can } from "@/lib/rbac/can";
import { capabilityDefinition, type CapabilityKey } from "@/lib/rbac/capabilities";
import { decideOfficeSend, OFFICE_SEND_POLICIES, type OfficeActorRole, type OfficeSendAction, type OfficeSendDecision } from "./office-send-rules";

/** The person a gated office send is recorded against: the real signed-in user and the role that allowed it. */
export type OfficeActor = { id: string; role: OfficeActorRole };

export class OfficeSendDenied extends Error {
  readonly status = 403;
  constructor(message: string) { super(message); }
}

/**
 * Decides for an already-resolved session. Pack levels are read live
 * (`getOpsAccess`) so a pack change applies to the next request; an
 * administrator's levels are never read (ADMIN never inherits a pack).
 */
export async function officeSendDecision(session: Session, action: OfficeSendAction): Promise<OfficeSendDecision> {
  const heldRoles = session.user.heldRoles ?? [session.user.role];
  const levels = heldRoles.includes(Role.ADMIN) || session.impersonation
    ? null
    : await getOpsAccess({ id: session.user.id, role: String(session.user.role), heldRoles: heldRoles.map(String) });
  const decision = decideOfficeSend({ heldRoles: heldRoles.map(String), impersonating: Boolean(session.impersonation), levels }, action);
  // The pack level allows it: an administrator may still have switched this
  // capability off for the person (access screen). Same shared evaluator as
  // every other capability; administrators are never narrowed.
  if (decision.allowed && decision.actorRole === "OPS_MANAGER" && !(await can(session, OFFICE_SEND_CAPABILITY[action]))) {
    return { allowed: false, actorRole: null, reason: `Your access does not include: ${capabilityDefinition(OFFICE_SEND_CAPABILITY[action]).label}. ${OFFICE_SEND_POLICIES[action].instead}` };
  }
  return decision;
}

/** The capability each office send is (lib/rbac/capabilities.ts). */
export const OFFICE_SEND_CAPABILITY: Readonly<Record<OfficeSendAction, CapabilityKey>> = {
  supplier_chase: "laundry.supplier_chase",
  guest_message: "lostfound.guest_message",
  lost_item_client_notice: "lostfound.client_notice",
  client_delay_notice: "jobs.client_delay_notice",
  clock_pause: "jobs.clock_pause",
  account_email: "accounts.account_email",
  job_team_message: "jobs.team_message",
};

/**
 * The server gate for every gated send route: the live session guard
 * (`requireRole`, which re-reads the account, its roles and the request path's
 * ops pack), then the action's own pack rule. Throws FORBIDDEN / UNAUTHORIZED
 * from the session guard, or `OfficeSendDenied` (403) with the reason.
 */
export async function requireOfficeSend(action: OfficeSendAction): Promise<{ session: Session; actor: OfficeActor }> {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const decision = await officeSendDecision(session, action);
  if (!decision.allowed) throw new OfficeSendDenied(decision.reason);
  return { session, actor: { id: session.user.id, role: decision.actorRole } };
}
