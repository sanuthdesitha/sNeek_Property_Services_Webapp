/**
 * Role-aware onboarding steps (board "Public and sign in", screen 3).
 *
 * Which sections a role fills is unchanged from the single-page form: business
 * details for CLIENT and LAUNDRY, bank details for CLEANER and LAUNDRY, your
 * details for everyone. The board splits them into steps and ends on Finish.
 * Completion is still decided by the server (`PATCH /api/me/onboarding`
 * answers `onboardingComplete` and `missingFields`). Plain module.
 */
export type OnboardingRole = "ADMIN" | "OPS_MANAGER" | "CLEANER" | "CLIENT" | "LAUNDRY" | string;

export type OnboardingStepKey = "details" | "business" | "bank" | "finish";

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
}

const LABELS: Record<OnboardingStepKey, string> = {
  details: "Your details",
  business: "Business",
  bank: "Bank for pay",
  finish: "Finish",
};

export function roleNeedsBusiness(role: OnboardingRole | undefined): boolean {
  return role === "CLIENT" || role === "LAUNDRY";
}

export function roleNeedsBank(role: OnboardingRole | undefined): boolean {
  return role === "CLEANER" || role === "LAUNDRY";
}

export function onboardingSteps(role: OnboardingRole | undefined): OnboardingStep[] {
  const keys: OnboardingStepKey[] = ["details"];
  if (roleNeedsBusiness(role)) keys.push("business");
  if (roleNeedsBank(role)) keys.push("bank");
  keys.push("finish");
  return keys.map((key) => ({ key, label: LABELS[key] }));
}

/** The step holding a field the server says is still missing. */
export function stepForMissingField(field: string): OnboardingStepKey {
  if (field === "bankDetails" || field.startsWith("bank")) return "bank";
  if (field === "businessName" || field === "abn") return "business";
  return "details";
}

/** The first step (in order) that holds a missing field, or null. */
export function firstStepWithMissing(steps: readonly OnboardingStep[], missing: readonly string[]): OnboardingStepKey | null {
  const wanted = new Set(missing.map(stepForMissingField));
  return steps.find((step) => wanted.has(step.key))?.key ?? null;
}
