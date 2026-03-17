import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { generateOtpCode, hashOtp, otpExpiresAt, OTP_EXPIRY_MINUTES } from "@/lib/auth/otp";
import { assertCanResendOtp, recordOtpSent } from "@/lib/auth/otp-state";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";

interface IssueSignupOtpOptions {
  enforceCooldown?: boolean;
}

export async function issueSignupOtp(email: string, options: IssueSignupOtpOptions = {}) {
  const normalized = email.toLowerCase();
  const identifier = `signup:${normalized}`;

  if (options.enforceCooldown) {
    const resendStatus = await assertCanResendOtp(identifier);
    if (!resendStatus.ok) {
      return { ok: false as const, error: resendStatus.message };
    }
  }

  const code = generateOtpCode();
  const token = hashOtp(identifier, code);
  const expires = otpExpiresAt();

  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({ data: { identifier, token, expires } });

  const settings = await getAppSettings();
  const emailTemplate = renderEmailTemplate(settings, "signupOtp", {
    code,
    expiryMinutes: OTP_EXPIRY_MINUTES,
    email: normalized,
  });
  const sent = await sendEmailDetailed({
    to: normalized,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  if (!sent.ok) {
    return { ok: false as const, error: sent.error ?? "Could not send verification code." };
  }

  await recordOtpSent(identifier);
  return { ok: true as const };
}
