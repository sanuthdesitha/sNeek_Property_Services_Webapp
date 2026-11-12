/**
 * Account emails the office can (re)send from Accounts, and who may send them.
 * PLAIN module (no server imports): shared by the routes, the service and the
 * person panel.
 *
 * Inventory of account-related emails the app sends (2026-11-12):
 *  - INVITATION      set-password invitation link (UserInvitation), sent when
 *                    an admin creates a person in invite mode. RESENDABLE: a
 *                    fresh link replaces the previous one. Copy link allowed
 *                    (the create screen already shows it to the admin).
 *  - PASSWORD_RESET  password reset link (30 minutes), sent by "Forgot
 *                    password" to the person's own address. RESENDABLE by the
 *                    office, to THAT person's account address only; the new
 *                    link replaces the previous one. No copy (whoever holds it
 *                    can take over the account).
 *  - SIGNUP_CODE     sign-up verification code for a self-registered account
 *                    that has not verified. RESENDABLE (the code service's own
 *                    cool-down also applies). Codes are never shown.
 *  Not resendable from here, by design:
 *  - temporary-password emails (admin "Reset password", client portal access,
 *    hiring conversion, lead → client, maintenance promotion): re-sending
 *    would mean mailing a new password; use "Send password reset link"
 *    instead, which never reveals or changes a password until the person
 *    chooses one. The original sends are listed in the history.
 *  - sign-in codes and two-factor emails: the person requests them while
 *    signing in; the office cannot usefully send one.
 *  - assistant (VA) invitations and document requests: their own screens
 *    (Clients › Assistants, Documents › Send reminder) already resend.
 *
 * Who may send: ADMIN; OPS_MANAGER only with the Staff accounts pack at manage
 * (office-send-rules `account_email`); nobody while impersonating; and never
 * for a person whose role is above the sender's (an operations manager cannot
 * send to an administrator).
 */

export const ACCOUNT_EMAIL_TYPES = ["INVITATION", "PASSWORD_RESET", "SIGNUP_CODE"] as const;
export type AccountEmailType = (typeof ACCOUNT_EMAIL_TYPES)[number];

/** One resend per person per type within this many minutes. */
export const ACCOUNT_EMAIL_COOL_DOWN_MINUTES = 5;

export const ACCOUNT_EMAIL_LABELS: Record<AccountEmailType, { name: string; button: string }> = {
  INVITATION: { name: "Invitation to set a password", button: "Resend invitation" },
  PASSWORD_RESET: { name: "Password reset link", button: "Send password reset link" },
  SIGNUP_CODE: { name: "Sign-up verification code", button: "Resend sign-up code" },
};

/** What the email provider said. Accepted is not delivered; unknown is not success. */
export type AccountEmailState = "ACCEPTED" | "NOT_ACCEPTED" | "UNKNOWN" | "SKIPPED" | "NOT_RECORDED";

export const ACCOUNT_EMAIL_STATE_LABELS: Record<AccountEmailState, string> = {
  ACCEPTED: "Accepted by the email provider (delivery not confirmed)",
  NOT_ACCEPTED: "Not sent: the email provider did not accept it",
  UNKNOWN: "Unknown: the provider's answer was not confirmed",
  SKIPPED: "Not sent: email is not configured or was switched off",
  NOT_RECORDED: "Not recorded",
};

const ROLE_RANK: Record<string, number> = { ADMIN: 3, OPS_MANAGER: 2 };

/** The highest rank among the roles a person holds (everyone else is 1). */
export function roleRank(roles: readonly string[]): number {
  return roles.reduce((best, role) => Math.max(best, ROLE_RANK[role] ?? 1), 1);
}

/** Null when the sender may act on the target by role, else why not. */
export function roleAboveRefusal(actorRoles: readonly string[], targetRoles: readonly string[]): string | null {
  return roleRank(targetRoles) > roleRank(actorRoles) ? "You cannot send account emails to someone whose role is above yours." : null;
}

export type AccountEmailTargetFacts = {
  isActive: boolean;
  emailVerified: boolean;
  /** The person's invitation, when one exists. */
  invitation: { acceptedAt: string | Date | null } | null;
};

/** Null when this email can be sent to the person now, else why not. */
export function accountEmailIneligibility(type: AccountEmailType, target: AccountEmailTargetFacts): string | null {
  if (!target.isActive) return "The account is disabled. Activate it first.";
  const pendingInvite = Boolean(target.invitation && !target.invitation.acceptedAt);
  switch (type) {
    case "INVITATION":
      return pendingInvite ? null : target.invitation ? "The invitation was already accepted. Send a password reset link instead." : "This person was not invited by link. Send a password reset link instead.";
    case "PASSWORD_RESET":
      return pendingInvite ? "This person has not accepted their invitation yet. Resend the invitation instead." : null;
    case "SIGNUP_CODE":
      if (target.invitation) return "This person was invited by link. Resend the invitation instead.";
      return target.emailVerified ? "The email address is already verified." : null;
  }
}

/** The email "Resend invite" means for a person: the invitation link when one is pending, else the sign-up code. */
export function resendInviteType(target: AccountEmailTargetFacts): AccountEmailType {
  return target.invitation && !target.invitation.acceptedAt ? "INVITATION" : "SIGNUP_CODE";
}
