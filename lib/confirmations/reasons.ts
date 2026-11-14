/**
 * QUICK-PICK REASONS for the confirmations that keep a required reason
 * ("simpler confirmations", owner default 2026-11-14, pending owner
 * confirmation: the choices are fixed in the product, not edited in Settings).
 *
 * Plain module (no "use client", no database): the shared reason picker, the
 * dialogs and the API routes read the same lists and the same rule.
 *
 * The rule: a required reason is one picked choice, or "Other…" with any
 * non-empty text. There is NO minimum length (the old 10- and 3-character
 * minimums are gone). The reason a person sees in history is the choice's
 * label, followed by the optional note: "Voided in Xero · CN-00412".
 */

export type ReasonChoice = {
  /** Stable id, safe to store or send. */
  id: string;
  /** What the person taps and what history shows. */
  label: string;
};

/** The id of the free-text choice every list ends with. */
export const OTHER_REASON_ID = "other";

const OTHER: ReasonChoice = { id: OTHER_REASON_ID, label: "Other…" };

export const REASON_CHOICES = {
  invoiceVoid: [
    { id: "duplicate", label: "Duplicate" },
    { id: "wrong-amount", label: "Wrong amount or lines" },
    { id: "wrong-client", label: "Wrong client" },
    { id: "job-cancelled", label: "Job cancelled" },
    OTHER,
  ],
  creditNoteVoid: [
    { id: "raised-by-mistake", label: "Raised by mistake" },
    { id: "wrong-amount", label: "Wrong amount" },
    { id: "duplicate", label: "Duplicate" },
    OTHER,
  ],
  xeroReconcile: [
    { id: "voided-in-xero", label: "Voided in Xero" },
    { id: "credit-note-in-xero", label: "Credit note in Xero" },
    { id: "duplicate-in-xero", label: "Duplicate in Xero" },
    OTHER,
  ],
  laundryVoid: [
    { id: "no-run", label: "No run took place" },
    { id: "made-by-mistake", label: "Made by mistake" },
    { id: "duplicate", label: "Duplicate run" },
    OTHER,
  ],
  laundryUndoVoid: [
    { id: "voided-by-mistake", label: "Voided by mistake" },
    { id: "run-took-place", label: "The run did take place" },
    OTHER,
  ],
  payAmountChange: [
    { id: "wrong-amount", label: "Wrong amount entered" },
    { id: "receipt-corrected", label: "Receipt corrected" },
    { id: "agreed", label: "Agreed with the cleaner" },
    OTHER,
  ],
  approvalRecordDelete: [
    { id: "by-mistake", label: "Recorded by mistake" },
    { id: "duplicate", label: "Duplicate record" },
    { id: "test", label: "Test entry" },
    OTHER,
  ],
  // A voided damage submission goes back to the cleaner, who sees the reason.
  damageVoid: [
    { id: "photos-unclear", label: "Photos do not show the damage" },
    { id: "wrong-item", label: "Wrong item or room" },
    { id: "details-missing", label: "Details are missing" },
    { id: "duplicate", label: "Duplicate report" },
    OTHER,
  ],
  // Property onboarding reject (2026-11-16): the onboarding keeps the reason.
  onboardingReject: [
    { id: "client-withdrew", label: "Client withdrew" },
    { id: "outside-area", label: "Outside our service area" },
    { id: "duplicate", label: "Duplicate onboarding" },
    { id: "not-a-fit", label: "Not a fit for our services" },
    OTHER,
  ],
} as const satisfies Record<string, readonly ReasonChoice[]>;

export type ReasonListKey = keyof typeof REASON_CHOICES;

/** What a reason picker holds: the picked choice (null = none yet) and the free text. */
export type ReasonValue = { choice: string | null; note: string };

export const EMPTY_REASON: ReasonValue = { choice: null, note: "" };

/**
 * The reason text to send, or null when the value does not satisfy the rule.
 * A picked choice gives its label; "Other…" gives its text, which must not be
 * empty. An optional `detail` (a note under "Add details") is appended as
 * " · detail".
 */
export function composeReason(choices: readonly ReasonChoice[], value: ReasonValue, detail?: string): string | null {
  if (!value.choice) return null;
  let base: string | null;
  if (value.choice === OTHER_REASON_ID) {
    base = value.note.trim() || null;
  } else {
    base = choices.find((choice) => choice.id === value.choice)?.label ?? null;
  }
  if (!base) return null;
  const extra = detail?.trim();
  return extra ? `${base} · ${extra}` : base;
}

/** Longest reason a route stores (a guard against pasted documents, not a minimum). */
export const REASON_MAX_LENGTH = 2000;

/**
 * Server side: the trimmed reason, or null when it is missing or empty.
 * Required reasons have no minimum length.
 */
export function requiredReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (!reason) return null;
  return reason.slice(0, REASON_MAX_LENGTH);
}

/** The refusal a route answers when a required reason is missing. */
export const REASON_REQUIRED_MESSAGE = "Pick a reason, or choose Other and say why.";
