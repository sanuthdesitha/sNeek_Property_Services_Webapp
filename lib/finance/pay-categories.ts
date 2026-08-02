/**
 * What KIND of money a pay adjustment is.
 *
 * The distinction that matters is EARNED vs REFUNDED. A cleaner who pays $12
 * for parking and gets $12 back is not $12 better off — they are back where
 * they started. Folding that into their services total says they earned it,
 * which is wrong on the document their tax return is built from.
 *
 * No GST arithmetic hangs off this (owner decision, 2026-08): the invoice
 * simply prints the two groups under separate headings with separate totals.
 */
export const PAY_ADJUSTMENT_CATEGORIES = [
  {
    value: "SERVICE",
    label: "Work / service",
    hint: "Extra time, a bonus, a rework payment — money earned.",
    taxable: true,
  },
  {
    value: "PARKING",
    label: "Parking",
    hint: "A parking fee you paid at the property. Attach the ticket.",
    taxable: false,
  },
  {
    value: "REIMBURSEMENT",
    label: "Reimbursement / receipt",
    hint: "Something you bought for the job out of your own pocket.",
    taxable: false,
  },
] as const;

export type PayAdjustmentCategory = (typeof PAY_ADJUSTMENT_CATEGORIES)[number]["value"];

export const PAY_ADJUSTMENT_CATEGORY_VALUES = PAY_ADJUSTMENT_CATEGORIES.map((c) => c.value) as [
  PayAdjustmentCategory,
  ...PayAdjustmentCategory[],
];

/**
 * Whether a category is taxable income to the payee.
 *
 * Unknown values resolve to TRUE. A category we don't recognise is far more
 * likely to be work than a refund, and treating it as a reimbursement would
 * quietly shrink someone's declared earnings.
 */
export function isTaxableCategory(category: string | null | undefined): boolean {
  if (!category) return true;
  const found = PAY_ADJUSTMENT_CATEGORIES.find((c) => c.value === category);
  return found ? found.taxable : true;
}

/** Human label for a stored category value, falling back to the raw value. */
export function payCategoryLabel(category: string | null | undefined): string {
  if (!category) return "Work / service";
  return PAY_ADJUSTMENT_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}
