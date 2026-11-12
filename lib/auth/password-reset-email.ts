import { escapeHtml } from "@/lib/utils/escape-html";
import { RECOVERY_TTL_MINUTES, appBaseUrl } from "@/lib/auth/recovery";

/**
 * The password reset email, shared by "Forgot password" (the person asks) and
 * Accounts "Send password reset link" (the office sends it to the person's own
 * account address). Same wording, same link, same 30-minute token.
 */
export function passwordResetLink(email: string, rawToken: string): string {
  return `${appBaseUrl()}/reset-password?email=${encodeURIComponent(email)}&token=${rawToken}`;
}

export function passwordResetEmail(input: { name: string | null; link: string; sentByOffice?: boolean }): { subject: string; html: string } {
  const greeting = escapeHtml(input.name?.trim() || "there");
  const reason = input.sentByOffice
    ? "Our office sent you a link to set a new password."
    : "We received a request to reset your password.";
  return {
    subject: "Reset your sNeek password",
    html: `<p>Hi ${greeting},</p><p>${reason} Click below to set a new one — this link expires in ${RECOVERY_TTL_MINUTES} minutes.</p><p><a href="${input.link}" style="display:inline-block;background:#0f5a44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Reset password</a></p><p>If you didn't expect this, you can safely ignore this email — your password won't change.</p>`,
  };
}
