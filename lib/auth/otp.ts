import { createHash, randomInt } from "crypto";

const OTP_MINUTES = 10;

function otpSecret() {
  return process.env.NEXTAUTH_SECRET || "dev-secret";
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(identifier: string, code: string): string {
  return createHash("sha256")
    .update(`${identifier.toLowerCase()}:${code}:${otpSecret()}`)
    .digest("hex");
}

export function otpExpiresAt(minutes = OTP_MINUTES): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export const OTP_EXPIRY_MINUTES = OTP_MINUTES;

