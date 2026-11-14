/**
 * Rules for a person's OWN sensitive-action PIN (owner decision 2026-11-13:
 * "Yes PIN, but make the PIN settable for ops manager as their own one and do
 * not share admins' PINs").
 *
 * Plain module (no "use client", no database): the server verification, the
 * profile section and every PIN prompt read the same limits and the same
 * wording from here.
 */

export const PIN_MIN_DIGITS = 4;
export const PIN_MAX_DIGITS = 12;
/** Wrong PIN or password attempts in a row before verification locks. */
export const PIN_LOCK_THRESHOLD = 5;
/** How long a locked verification stays locked. */
export const PIN_LOCK_MINUTES = 15;

/** Digits only, at most the maximum length. Anything else is dropped, never rounded into a PIN. */
export function normalizePinInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").slice(0, PIN_MAX_DIGITS);
}

/** Why a new PIN cannot be used, or null when it can. */
export function newPinProblem(pin: unknown, confirm?: unknown): string | null {
  if (typeof pin !== "string" || !/^\d+$/.test(pin.trim())) return `Your PIN must be ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`;
  const digits = pin.trim();
  if (digits.length < PIN_MIN_DIGITS || digits.length > PIN_MAX_DIGITS) return `Your PIN must be ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`;
  if (/^(\d)\1+$/.test(digits)) return "Choose a PIN that is not one digit repeated.";
  if (confirm !== undefined && confirm !== pin) return "The two PINs do not match.";
  return null;
}

/**
 * Codes `verifySensitiveAction` refuses with. The first four keep their
 * historic meaning (routes already map them); the rest are new with per-person
 * PINs. `Error.message` is the code for the historic four and a sentence a
 * person can read for the new ones, so routes that pass the message through
 * show something readable.
 */
export type SensitiveVerificationCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PIN_OR_PASSWORD_REQUIRED"
  | "INVALID_SECURITY_VERIFICATION"
  | "PIN_REQUIRED"
  | "PIN_SETUP_REQUIRED"
  | "PIN_LOCKED"
  | "NEW_PIN_INVALID"
  | "ACTUAL_ACTOR_REQUIRED";

export const SENSITIVE_VERIFICATION_TEXT: Record<SensitiveVerificationCode, string> = {
  UNAUTHORIZED: "Sign in again to continue.",
  FORBIDDEN: "Your access does not include this action.",
  PIN_OR_PASSWORD_REQUIRED: "Enter your PIN.",
  INVALID_SECURITY_VERIFICATION: "That was not accepted. Check your PIN and try again.",
  PIN_REQUIRED: "Enter your own PIN. Your password no longer confirms this. Forgot your PIN? Change it in your profile with your password.",
  PIN_SETUP_REQUIRED: "You have no PIN yet. Enter your account password to confirm.",
  PIN_LOCKED: `Too many wrong attempts. Try again in ${PIN_LOCK_MINUTES} minutes, or ask an administrator to reset your PIN.`,
  NEW_PIN_INVALID: `Your PIN must be ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`,
  ACTUAL_ACTOR_REQUIRED: "Sensitive actions cannot be confirmed while testing as someone else. Stop testing first.",
};

const HISTORIC_CODES = new Set<SensitiveVerificationCode>([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PIN_OR_PASSWORD_REQUIRED",
  "INVALID_SECURITY_VERIFICATION",
]);

/** What `Error.message` carries for a code (see SensitiveVerificationCode). */
export function sensitiveVerificationErrorMessage(code: SensitiveVerificationCode): string {
  return HISTORIC_CODES.has(code) ? code : SENSITIVE_VERIFICATION_TEXT[code];
}

/** A readable sentence for whatever a route answered (a code or already a sentence). */
export function sensitiveVerificationText(error: unknown): string {
  if (typeof error !== "string" || !error.trim()) return SENSITIVE_VERIFICATION_TEXT.INVALID_SECURITY_VERIFICATION;
  return (SENSITIVE_VERIFICATION_TEXT as Record<string, string>)[error] ?? error;
}

/**
 * Credentials a PIN prompt sends: the person's own PIN, or — only while they
 * have none — their account password (owner default 2026-11-14). `newPin` is
 * still accepted with the password from older prompts and is then stored.
 */
export interface SensitiveCredentialsInput {
  pin?: string;
  password?: string;
  newPin?: string;
}
