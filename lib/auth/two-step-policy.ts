/**
 * Two-step sign-in requirement (owner default 2026-11-16, pending owner
 * confirmation): REQUIRED for administrators, SUGGESTED for operations
 * managers.
 *
 * "Required" is an enrolment prompt with a grace period, never a lock-out:
 *   - the first admin page an administrator opens without two-step on starts
 *     a 14-day grace period (User.twoStepRequiredSince);
 *   - during the grace period a reminder names the deadline;
 *   - after it, every admin page sends them to Your profile › Two-step
 *     sign-in, which stays reachable, as do sign-out and the 2FA endpoints;
 *   - an administrator who loses their second factor is reset by another
 *     administrator with their own PIN, exactly as before.
 * A passkey sign-in is allowed on its own (owner default); it does not turn
 * two-step on, so the password route still asks for it.
 *
 * PURE: no DB, no I/O. Plain module, safe for server pages and tests.
 */

export const TWO_STEP_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the prompt sends someone after the grace period. */
export const TWO_STEP_SETUP_PATH = "/v2/admin/profile?setup=two-step";

/**
 * Where a person manages their own two-step sign-in (and backup codes), by
 * primary role. Used by the "backup code used" notice and the sign-in screen.
 */
export function twoStepSettingsPath(role: string): string {
  switch (role) {
    case "ADMIN":
    case "OPS_MANAGER":
      return TWO_STEP_SETUP_PATH;
    case "MAINTENANCE":
      return "/v2/maintenance/settings";
    case "CLEANER":
      return "/v2/cleaner/profile";
    case "CLIENT":
      return "/v2/client/profile";
    case "LAUNDRY":
      return "/v2/laundry/profile";
    case "QA_INSPECTOR":
      return "/v2/qa/profile";
    default:
      return "/v2";
  }
}

/** Only administrators and operations managers can make a new set on its own (Your profile). */
export function canMakeBackupCodesInProfile(role: string): boolean {
  return role === "ADMIN" || role === "OPS_MANAGER";
}

export type TwoStepRequirementInput = {
  holdsAdmin: boolean;
  holdsOpsManager: boolean;
  twoFactorEnabled: boolean;
  requiredSince: Date | null;
};

export type TwoStepRequirement =
  | { kind: "not_applicable" }
  | { kind: "met"; required: boolean }
  | { kind: "suggested" }
  /** Required, not yet on; `deadline` null when the grace period has not started. */
  | { kind: "grace"; deadline: Date | null }
  | { kind: "setup_required"; since: Date };

export function graceDeadline(requiredSince: Date): Date {
  return new Date(requiredSince.getTime() + TWO_STEP_GRACE_DAYS * DAY_MS);
}

export function twoStepRequirement(input: TwoStepRequirementInput, now: Date = new Date()): TwoStepRequirement {
  if (!input.holdsAdmin && !input.holdsOpsManager) return { kind: "not_applicable" };
  if (input.twoFactorEnabled) return { kind: "met", required: input.holdsAdmin };
  if (!input.holdsAdmin) return { kind: "suggested" };
  if (!input.requiredSince) return { kind: "grace", deadline: null };
  const deadline = graceDeadline(input.requiredSince);
  if (now.getTime() < deadline.getTime()) return { kind: "grace", deadline };
  return { kind: "setup_required", since: deadline };
}

/**
 * Admin pages the requirement never redirects away from: the profile page
 * itself (where two-step is set up) and the access-denied explainer.
 */
export function pageExemptFromTwoStep(path: string): boolean {
  return /^\/v2\/admin\/(profile|access-denied)(?:[/?#]|$)/.test(path);
}

/** True for an admin portal page request (not an API call). */
export function isAdminPortalPage(path: string | null | undefined): path is string {
  return typeof path === "string" && /^\/v2\/admin(?:[/?#]|$)/.test(path);
}
