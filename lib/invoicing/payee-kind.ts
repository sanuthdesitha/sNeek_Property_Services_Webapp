/**
 * WHAT KIND OF WORK IS ON THIS INVOICE.
 *
 * `payeeRole` used to be a straight copy of `User.role`, stamped into the
 * invoice snapshot at send time and frozen there forever. That worked only
 * because a person was exactly one thing. Under multi-role they are not, and a
 * single scalar describing a whole invoice becomes a lie the moment somebody
 * bills a clean and an inspection on the same document.
 *
 * The consequences were not cosmetic. `xero-push` applies ONE label to EVERY
 * line — a mixed invoice would arrive in the accounting system with every line
 * described as "Cleaning services", or every line as "QA inspection services",
 * whichever the account's role happened to say. That is the wrong description
 * against the wrong work, and it surfaces at reconciliation rather than at send.
 *
 * SO IT IS DERIVED FROM THE CONTENTS, not from the account. An invoice holding
 * both is MIXED, and every consumer that used to branch two ways now has a third
 * case to answer honestly.
 *
 * PURE — no database.
 */

export type InvoicePayeeKind = "CLEANING" | "INSPECTIONS" | "MIXED";

/**
 * Decide from what the invoice actually contains.
 *
 * An EMPTY invoice is CLEANING rather than a fourth state. There is nothing to
 * mislabel on a document with no lines, and inventing an "UNKNOWN" would push a
 * meaningless branch into every caller for a case that carries no money.
 */
export function invoicePayeeKind(input: {
  cleaningLineCount: number;
  inspectionLineCount: number;
}): InvoicePayeeKind {
  const hasCleaning = input.cleaningLineCount > 0;
  const hasInspections = input.inspectionLineCount > 0;
  if (hasCleaning && hasInspections) return "MIXED";
  if (hasInspections) return "INSPECTIONS";
  return "CLEANING";
}

/** How the invoice describes itself — on the PDF, in an email subject, in Xero. */
export function payeeKindLabel(kind: InvoicePayeeKind): string {
  switch (kind) {
    case "INSPECTIONS":
      return "QA inspector";
    case "MIXED":
      // Named for the person, not for one of the two things they did. "Cleaner
      // and QA inspector" is what an accounts clerk needs in order to understand
      // why one document carries both kinds of line.
      return "Cleaner and QA inspector";
    default:
      return "Cleaner";
  }
}

/** Filename stem for the generated PDF. */
export function payeeKindFileStem(kind: InvoicePayeeKind): string {
  switch (kind) {
    case "INSPECTIONS":
      return "qa-inspector-invoice";
    case "MIXED":
      return "payee-invoice";
    default:
      return "cleaner-invoice";
  }
}

/**
 * The description a Xero line falls back to when it carries none of its own.
 *
 * PER LINE, never per invoice. This is the fix for the actual defect: the label
 * has to follow which stream produced the line, so a mixed bill describes its
 * cleans as cleaning and its inspections as inspections.
 */
export function xeroLineFallbackDescription(source: "CLEANING" | "INSPECTION"): string {
  return source === "INSPECTION" ? "QA inspection services" : "Cleaning services";
}

/**
 * Read the kind back off a stored snapshot.
 *
 * Historical invoices carry `payeeRole` as a bare `Role` string, written before
 * this existed. They are INTERPRETED rather than migrated: the snapshot is what
 * was actually sent, and rewriting it would alter a document somebody already
 * holds. Anything unrecognised reads as CLEANING, which is what the old code
 * did with it.
 */
export function payeeKindFromSnapshot(stored: string | null | undefined): InvoicePayeeKind {
  if (stored === "MIXED" || stored === "INSPECTIONS" || stored === "CLEANING") return stored;
  if (stored === "QA_INSPECTOR") return "INSPECTIONS";
  return "CLEANING";
}
