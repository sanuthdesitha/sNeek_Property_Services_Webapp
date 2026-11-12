import "server-only";
import type { Session } from "next-auth";
import { getOpsPolicy } from "./ops-access";
import { evaluateCapability, isAdministrator, type AccessSubject } from "./access-evaluator";
import { capabilityDefinition, type CapabilityKey } from "./capabilities";
import { isOpsSubject } from "./ops-policy";

/**
 * The shared server-side capability check. Called at each existing
 * enforcement point AFTER that point's live session/role guard (requireRole,
 * requireSession or a database re-read), never instead of it.
 *
 * - The session passed in is the EFFECTIVE identity: while an administrator
 *   tests as someone, it is the target, so the target's restrictions apply.
 * - Administrators are answered without reading any policy (ADMIN never
 *   inherits a pack). Other subjects read the live policy on every call:
 *   there is no cache, so a saved change applies to the next request.
 */
export async function canSubject(subject: AccessSubject, key: CapabilityKey): Promise<boolean> {
  if (isAdministrator(subject)) return true;
  if (!isOpsSubject({ role: subject.role, heldRoles: subject.heldRoles ? [...subject.heldRoles] : undefined })) return false;
  return evaluateCapability(await getOpsPolicy(), subject, key);
}

export function sessionSubject(session: Session): AccessSubject {
  return {
    id: session.user.id,
    role: String(session.user.role),
    heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String),
  };
}

export async function can(session: Session, key: CapabilityKey): Promise<boolean> {
  return canSubject(sessionSubject(session), key);
}

export class CapabilityDenied extends Error {
  readonly status = 403;
  readonly capability: CapabilityKey;
  constructor(key: CapabilityKey) {
    super(`Your access does not include: ${capabilityDefinition(key).label}. Ask an administrator if you need it.`);
    this.capability = key;
  }
}

/** Throws CapabilityDenied (403) when the effective identity lacks the capability. */
export async function requireCapability(session: Session, key: CapabilityKey): Promise<void> {
  if (!(await can(session, key))) throw new CapabilityDenied(key);
}
