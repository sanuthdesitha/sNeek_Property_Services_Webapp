import "server-only";
import { OrgStatus } from "@prisma/client";

/**
 * Workspace access rules driven by an organization's subscription status.
 *
 * When a trial ends or dunning lapses (status LOCKED/CANCELED), the workspace
 * goes READ-ONLY: GETs and the billing pages keep working so the owner can add a
 * payment method, but mutations are rejected with HTTP 402 (Payment Required).
 * Hard data deletion only happens after a long grace period (handled elsewhere).
 */

export class WorkspaceLockedError extends Error {
  readonly httpStatus = 402;
  constructor(public readonly status: OrgStatus) {
    super("WORKSPACE_LOCKED");
    this.name = "WorkspaceLockedError";
  }
}

/** Statuses under which the workspace can still be written to. */
export function isWorkspaceWritable(status: OrgStatus): boolean {
  return status === OrgStatus.TRIALING || status === OrgStatus.ACTIVE || status === OrgStatus.PAST_DUE;
}

/** Read access is allowed in every status (so the owner can pay/export). */
export function isWorkspaceReadable(_status: OrgStatus): boolean {
  return true;
}

/** Throw a 402-mapped error if the workspace is not currently writable. */
export function assertWorkspaceWritable(status: OrgStatus): void {
  if (!isWorkspaceWritable(status)) {
    throw new WorkspaceLockedError(status);
  }
}

/**
 * The effective status, accounting for an expired trial. Stored status is the
 * source of truth, but a TRIALING org whose trialEndsAt has passed (and that has
 * no active paid subscription) is treated as LOCKED until the billing webhook or
 * a scheduled sweep persists the transition.
 */
export function resolveEffectiveStatus(
  org: { status: OrgStatus; trialEndsAt: Date | null },
  now: Date
): OrgStatus {
  if (org.status === OrgStatus.TRIALING && org.trialEndsAt && org.trialEndsAt.getTime() <= now.getTime()) {
    return OrgStatus.LOCKED;
  }
  return org.status;
}

/** Whole-number days left in the trial (0 if ended / not trialing). */
export function trialDaysRemaining(
  org: { status: OrgStatus; trialEndsAt: Date | null },
  now: Date
): number {
  if (org.status !== OrgStatus.TRIALING || !org.trialEndsAt) return 0;
  const ms = org.trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (1000 * 60 * 60 * 24));
}
