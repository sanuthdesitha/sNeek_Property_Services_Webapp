import { RECOVERY_TTL_MINUTES, appBaseUrl } from "@/lib/auth/recovery";
import { buildDesignedEmail } from "@/lib/email-design/build-email";
import type { CompanySettingsLike } from "@/lib/email-design/compose";

/**
 * The password reset email, shared by "Forgot password" (the person asks),
 * Accounts "Send password reset link" (the office sends it to the person's
 * own account address) and the administrator's reset (2026-11-16: a one-time
 * link instead of an emailed temporary password). Same link, same 30-minute
 * single-use token (lib/auth/recovery.ts). Fixed security email: design
 * "resetPassword" (lib/email-design); the send path renders it with the
 * published Email look and the Company details.
 */
export function passwordResetLink(email: string, rawToken: string): string {
  return `${appBaseUrl()}/reset-password?email=${encodeURIComponent(email)}&token=${rawToken}`;
}

export type PasswordResetReason = "self" | "office" | "administrator";

const REASON_LINE: Record<PasswordResetReason, string> = {
  self: "We received a request to reset your password.",
  office: "Our office sent you a link to set a new password.",
  administrator: "An administrator reset your password and sent you this link to choose a new one.",
};

export function passwordResetEmail(input: {
  name: string | null;
  email: string;
  link: string;
  sentByOffice?: boolean;
  reason?: PasswordResetReason;
  settings?: CompanySettingsLike;
}): { subject: string; html: string; text: string } {
  const reason = input.reason ?? (input.sentByOffice ? "office" : "self");
  return buildDesignedEmail(input.settings ?? { companyName: "sNeek Property Services" }, "resetPassword", {
    userName: input.name?.trim() ?? "",
    email: input.email,
    resetUrl: input.link,
    expiryMinutes: String(RECOVERY_TTL_MINUTES),
    reasonLine: REASON_LINE[reason],
  });
}
