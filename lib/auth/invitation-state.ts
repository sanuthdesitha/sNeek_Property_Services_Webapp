/**
 * What an invitation link may do now (pure; shared by the accept page and the
 * accept API so their answers never drift). Order matters and is unchanged
 * from before, with "revoked" (owner decision 2026-11-13) added after
 * "accepted": not recognised, already used, withdrawn by the office, expired,
 * account unavailable, then valid.
 */
export type InvitationLinkState = "invalid" | "accepted" | "revoked" | "expired" | "inactive" | "valid";

export type InvitationLinkFacts = {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  user: { isActive: boolean };
} | null;

export function invitationLinkState(invite: InvitationLinkFacts, now: Date = new Date()): InvitationLinkState {
  if (!invite) return "invalid";
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() < now.getTime()) return "expired";
  if (!invite.user.isActive) return "inactive";
  return "valid";
}

/** The words each refused state answers with (API and page). */
export const INVITATION_REFUSAL_TEXT: Record<Exclude<InvitationLinkState, "valid">, string> = {
  invalid: "Invalid invitation.",
  accepted: "This invitation has already been accepted.",
  revoked: "This invitation was withdrawn. Ask the office for a new one.",
  expired: "This invitation has expired.",
  inactive: "This account is no longer active.",
};
