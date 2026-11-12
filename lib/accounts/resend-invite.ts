/**
 * "Resend invite" (person menu, `POST /api/admin/users/[id]/resend-otp`, and
 * the Accounts bulk action): the email that actually lets this person in.
 *
 * Fixed 2026-11-12: it always sent a sign-up verification CODE, but people the
 * office invites get an invitation LINK (UserInvitation) and have no password,
 * so the code could not get them in. Now: a pending invitation gets a fresh
 * invitation link (the old link stops working); a self-registered, unverified
 * login gets a fresh sign-up code. Through the Account emails service, so the
 * sender rules (ADMIN, or OPS_MANAGER with Staff accounts at manage; never
 * while impersonating; never to a higher role), the per-person cool-down and
 * the audit with the provider's answer all apply.
 */
import { db } from "@/lib/db";
import { resendInviteType } from "./account-email-rules";
import { AccountEmailError, sendAccountEmail, type AccountEmailActor } from "./account-emails";
import type { AccountEmailOrigin } from "./account-email-record";

export type ResendInviteResult =
  | { ok: true; message: string }
  | { ok: false; status: number; error: string };

export async function resendInvite(actor: AccountEmailActor, userId: string, origin: AccountEmailOrigin = "PERSON_PANEL"): Promise<ResendInviteResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, emailVerified: true, isActive: true, invitation: { select: { acceptedAt: true } } },
  });
  if (!user) return { ok: false, status: 404, error: "User not found." };
  const type = resendInviteType({ isActive: user.isActive, emailVerified: Boolean(user.emailVerified), invitation: user.invitation });
  try {
    const sent = await sendAccountEmail(actor, user.id, type, origin);
    if (sent.state !== "ACCEPTED") return { ok: false, status: 502, error: `${type === "INVITATION" ? "Invitation" : "Sign-up code"}: ${sent.stateLabel}${sent.error ? ` (${sent.error})` : ""}.` };
    return { ok: true, message: type === "INVITATION" ? "Invitation link sent." : "Sign-up code sent." };
  } catch (error) {
    if (error instanceof AccountEmailError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }
}
