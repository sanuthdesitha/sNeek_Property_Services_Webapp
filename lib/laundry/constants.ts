/**
 * The one list of laundry skip reasons. Import it; never re-declare it.
 *
 * This list had diverged into three copies: this one, and a different set in
 * components/v2/cleaner/job-stages/shared.ts and job-workspace.tsx. The cleaner
 * write path validated the code only as `z.string().max(120)`, so a v2 cleaner
 * could store LINEN_STILL_DRYING / NO_LINEN_ON_SITE / NO_PICKUP_REQUIRED —
 * codes the admin PATCH (app/api/admin/laundry/[taskId]/route.ts) z.enums
 * against THIS list and rejects. Because the admin edit form round-trips the
 * stored code back in its payload, one such value made every admin save on that
 * task fail with a 400 — not just an edit to the reason field. The task was
 * permanently unsavable.
 *
 * The merged list below is therefore the UNION of both sets, not the old
 * canonical one: the v2 codes already exist in live rows, and dropping them
 * would leave exactly the tasks this fix is meant to unblock still stuck.
 *
 * Adding a code here is safe. REMOVING one is not — an existing row carrying it
 * becomes unsavable again. Retire a code by hiding it from the pickers and
 * leaving it in this list.
 */
export const LAUNDRY_SKIP_REASONS = [
  { value: "NO_LINEN_USED", label: "No linen used" },
  { value: "NO_LINEN_ON_SITE", label: "No linen on site" },
  { value: "LINEN_STILL_WASHING", label: "Linen still washing" },
  { value: "LINEN_STILL_DRYING", label: "Linen still drying" },
  { value: "NO_PICKUP_REQUIRED", label: "No pickup required" },
  { value: "BUFFER_SET_USED", label: "Buffer set used" },
  { value: "GUEST_STILL_USING_ITEMS", label: "Guest still using items" },
  { value: "ADMIN_INSTRUCTION", label: "Admin instruction" },
  { value: "OTHER", label: "Other" },
] as const;

export type LaundrySkipReasonCode = (typeof LAUNDRY_SKIP_REASONS)[number]["value"];

/** The accepted codes, for zod enums and runtime membership checks. */
export const LAUNDRY_SKIP_REASON_CODES = LAUNDRY_SKIP_REASONS.map((row) => row.value) as [
  LaundrySkipReasonCode,
  ...LaundrySkipReasonCode[],
];

export function isLaundrySkipReasonCode(value: unknown): value is LaundrySkipReasonCode {
  return (
    typeof value === "string" &&
    LAUNDRY_SKIP_REASON_CODES.includes(value as LaundrySkipReasonCode)
  );
}
