/**
 * WHERE an approved, client-billed pay request lands on a client invoice
 * (pure; 2026-11-18).
 *
 * Owner request: "automatically add to the invoices as an extra note under the
 * same property job on the related date, on the same field, total should be
 * combined but the descriptions should show the details".
 *
 *   - The job's line is on THIS draft  → fold into that line: one line, total =
 *     base + extras, description = base, "Base service $X", each extra.
 *   - The job is already on another live invoice (approved, sent, paid, in
 *     Xero — or a draft generated earlier) → the extra is its own line here,
 *     grouped under the job's property and naming the job's date. The issued
 *     document is never touched.
 *   - The job is not billed yet and not on this draft → it waits for the job's
 *     own invoice, where it will fold.
 *   - No job → its own line under the request's property.
 *
 * A line whose quantity is not one cannot carry a fold honestly (it would
 * multiply the extra), so the extra becomes its own line beside it.
 */
import {
  clientExtraText,
  composeFoldedClientLine,
  relatedJobText,
} from "@/lib/pay-adjustments/invoice-text";

/** An approved extra that may be billed to this client now. */
export interface PayRequestClientCharge {
  adjustmentId: string;
  jobId: string | null;
  propertyId: string | null;
  amount: number;
  title: string | null;
  clientDescription: string | null;
  type: string | null;
  requestedHours: number | null;
  /** For an own line: the job it relates to. */
  job: { propertyName: string | null; date: string | null; jobNumber: string | null } | null;
}

/** The subset of a generated job line the plan touches. */
export interface PlannableJobLine {
  jobId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PayRequestOwnLine {
  adjustmentId: string;
  jobId: null;
  shoppingRunId: null;
  propertyId: string | null;
  description: string;
  note: null;
  quantity: 1;
  unitPrice: number;
  lineTotal: number;
  category: "SERVICE";
}

export interface PayRequestFold {
  adjustmentId: string;
  jobId: string;
  amount: number;
  text: string;
}

export interface PayRequestPlan<L extends PlannableJobLine> {
  /** The job lines, with every fold applied. */
  jobLines: L[];
  /** Extras billed as their own lines. */
  ownLines: PayRequestOwnLine[];
  folds: PayRequestFold[];
  /** Extras left for the job's own invoice. */
  waiting: string[];
}

/** The text an own line carries: the extra, then the job it relates to. */
export function ownLineDescription(charge: PayRequestClientCharge): string {
  const text = clientExtraText(charge, charge.amount);
  const related = relatedJobText(charge.job);
  return related ? `${text} — ${related}` : text;
}

function ownLine(charge: PayRequestClientCharge): PayRequestOwnLine {
  return {
    adjustmentId: charge.adjustmentId,
    jobId: null,
    shoppingRunId: null,
    propertyId: charge.propertyId,
    description: ownLineDescription(charge),
    note: null,
    quantity: 1,
    unitPrice: charge.amount,
    lineTotal: charge.amount,
    category: "SERVICE",
  };
}

export function planPayRequestCharges<L extends PlannableJobLine>(input: {
  jobLines: readonly L[];
  charges: readonly PayRequestClientCharge[];
  /** Jobs already on another live invoice of this client. */
  invoicedJobIds: ReadonlySet<string>;
  /** False when only jobs are being added to a draft (no own lines then). */
  includeOwnLines?: boolean;
}): PayRequestPlan<L> {
  const includeOwnLines = input.includeOwnLines !== false;
  const lineByJob = new Map(input.jobLines.map((line) => [line.jobId, line]));
  const foldsByJob = new Map<string, PayRequestFold[]>();
  const ownLines: PayRequestOwnLine[] = [];
  const waiting: string[] = [];

  for (const charge of input.charges) {
    const line = charge.jobId ? lineByJob.get(charge.jobId) : undefined;
    if (charge.jobId && line && line.quantity === 1) {
      const folds = foldsByJob.get(charge.jobId) ?? [];
      folds.push({ adjustmentId: charge.adjustmentId, jobId: charge.jobId, amount: charge.amount, text: clientExtraText(charge, charge.amount) });
      foldsByJob.set(charge.jobId, folds);
      continue;
    }
    const ownLineAllowed = !charge.jobId || Boolean(line) || input.invoicedJobIds.has(charge.jobId);
    if (includeOwnLines && ownLineAllowed) {
      ownLines.push(ownLine(charge));
    } else {
      waiting.push(charge.adjustmentId);
    }
  }

  const jobLines = input.jobLines.map((line) => {
    const folds = foldsByJob.get(line.jobId);
    if (!folds || folds.length === 0) return line;
    const composed = composeFoldedClientLine({
      baseDescription: line.description,
      baseAmount: line.unitPrice,
      quantity: line.quantity,
      extras: folds,
    });
    return composed ? { ...line, ...composed } : line;
  });

  return {
    jobLines,
    ownLines,
    folds: Array.from(foldsByJob.values()).flat(),
    waiting,
  };
}
