import "server-only";
import { db } from "@/lib/db";
import { invitationRevokeIneligibility } from "./account-email-rules";
import { AccountEmailError, facts, loadTarget, personRefusal, refusalStatus, type AccountEmailActor } from "./account-emails";

/**
 * REVOKE AN INVITATION (owner decision 2026-11-13).
 *
 * Same senders as "Resend invitation" (`resolveAccountEmailActor`): ADMIN, or
 * OPS_MANAGER with the Staff accounts pack at manage; never while testing as
 * someone; never on oneself or on a person whose role is above the actor's.
 * Account and assistant (VA) invitations are the same `UserInvitation` row,
 * so both go through here.
 *
 * The write is conditional (still not accepted and not revoked), so a link
 * accepted a moment earlier is never marked withdrawn, and two revokes record
 * one. The accept route claims the invitation with the matching condition, so
 * whichever lands first wins. Audited with the actual actor and role; the
 * token is never logged. A later "Resend invitation" issues a fresh link and
 * clears the revoked state (`createUserInvitation`).
 */

export const INVITATION_REVOKED_AUDIT_ACTION = "ACCOUNT_INVITATION_REVOKED";
export const INVITATION_REVOKE_BULK_MAX = 50;

export type InvitationRevokeResult = { userId: string; revokedAt: string };

export async function revokeInvitation(actor: AccountEmailActor, userId: string, now: Date = new Date()): Promise<InvitationRevokeResult> {
  const target = await loadTarget(userId);
  const refusal = personRefusal(actor, target) ?? invitationRevokeIneligibility(facts(target));
  if (refusal) throw new AccountEmailError(refusalStatus(refusal), refusal);
  return db.$transaction(async (tx) => {
    const updated = await tx.userInvitation.updateMany({
      where: { userId: target.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now, revokedById: actor.id },
    });
    if (updated.count !== 1) throw new AccountEmailError(409, "The invitation changed meanwhile (accepted or already withdrawn). Reload and check.");
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: INVITATION_REVOKED_AUDIT_ACTION,
        entity: "User",
        entityId: target.id,
        after: { actorRole: actor.role, revokedAt: now.toISOString(), targetRole: String(target.role), expiresAt: target.invitation?.expiresAt.toISOString() ?? null },
      },
    });
    return { userId: target.id, revokedAt: now.toISOString() };
  });
}

export type BulkRevokeOutcome = { userId: string; outcome: "revoked" | "refused"; error: string | null };

/** One person at a time through the same rules; a refusal keeps its reason and never stops the rest. */
export async function revokeInvitations(actor: AccountEmailActor, userIds: readonly string[], now: Date = new Date()): Promise<BulkRevokeOutcome[]> {
  const unique = Array.from(new Set(userIds)).slice(0, INVITATION_REVOKE_BULK_MAX);
  const results: BulkRevokeOutcome[] = [];
  for (const userId of unique) {
    try {
      await revokeInvitation(actor, userId, now);
      results.push({ userId, outcome: "revoked", error: null });
    } catch (error) {
      const message = error instanceof AccountEmailError ? error.message : "Could not revoke this invitation.";
      results.push({ userId, outcome: "refused", error: message });
    }
  }
  return results;
}
