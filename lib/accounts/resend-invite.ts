/**
 * "Resend invite": the same action `POST /api/admin/users/[id]/resend-otp`
 * has always performed — a sign-up code to an unverified or disabled login,
 * with the code issuer's own cooldown. Shared with the Accounts bulk route.
 */
import { db } from "@/lib/db";
import { issueSignupOtp } from "@/lib/auth/registration-otp";

export type ResendInviteResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 429; error: string };

export async function resendInvite(userId: string): Promise<ResendInviteResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, isActive: true },
  });
  if (!user) return { ok: false, status: 404, error: "User not found." };
  if (user.emailVerified && user.isActive) return { ok: false, status: 400, error: "User is already verified." };
  const sent = await issueSignupOtp(user.email, { enforceCooldown: true });
  if (!sent.ok) return { ok: false, status: 429, error: sent.error ?? "Try again shortly." };
  return { ok: true };
}
