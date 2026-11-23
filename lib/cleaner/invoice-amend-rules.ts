/**
 * Office amendments of a submitted cleaner (payee) invoice: the rules, as pure
 * functions shared by the server and the amend screen (2026-11-23).
 *
 * Owner request: "allow admin/ops manager to edit cleaners invoices after they
 * sent and any changes we made will be informed to the cleaner with the
 * changes made and amended invoice."
 *
 * Who may amend, by state (consistent with the transition table in
 * invoice-transitions.ts, where only an administrator approves):
 *   SUBMITTED    ADMIN and OPS_MANAGER; stays SUBMITTED (an administrator still approves it).
 *   APPROVED     ADMIN only; stays APPROVED (the administrator's amendment is their approval of the new figures).
 *   XERO_PUSHED  ADMIN only; stays XERO_PUSHED and is flagged "needs updating in Xero"
 *                (the existing Xero client cannot update a bill, so nothing is sent there).
 *   PAID, a recorded payment          refused: correct it with a pay adjustment.
 *   PAID_CLAIMED                      refused: confirm or reject the payee's claim first.
 *   XERO_EXPORTING                    refused: the push is in flight; retry or record payment.
 *   SENDING                           refused: delivery review first.
 *   CHANGES_REQUESTED, VOID           refused: the work was handed back to the payee.
 *
 * Lines keep their stored `kind` and `category` (and any other stored field);
 * the office edits the description, quantity and unit amount, removes lines
 * and adds lines. Removing a line does not hand its work back to the payee
 * (the job stays claimed by this invoice); to let them bill it again the
 * invoice is sent back for changes instead. Money is summed in whole cents.
 */

export type AmendRole = "ADMIN" | "OPS_MANAGER" | string;

export type AmendFacts = {
  status: string;
  xeroBillId: string | null;
  paidAt: Date | string | null;
  paidAmount: number | null;
};

export type AmendRefusal = { ok: false; status: 403 | 409; reason: string };
export type AmendPermission = { ok: true; needsXeroUpdate: boolean } | AmendRefusal;

export const PAID_AMEND_REFUSAL =
  "This invoice is paid, so it cannot be edited. Correct the money with a pay adjustment (Invoices and pay › Pay requests and adjustments); it appears on the payee's next invoice.";

export function amendPermission(facts: AmendFacts, role: AmendRole): AmendPermission {
  const paid = Boolean(facts.paidAt) || facts.paidAmount != null;
  if (facts.status === "PAID" || paid) return { ok: false, status: 409, reason: PAID_AMEND_REFUSAL };
  switch (facts.status) {
    case "SUBMITTED":
      return role === "ADMIN" || role === "OPS_MANAGER" ? { ok: true, needsXeroUpdate: false } : { ok: false, status: 403, reason: "Only an administrator or operations manager can amend a cleaner invoice." };
    case "APPROVED":
    case "XERO_PUSHED":
      if (role !== "ADMIN") {
        return { ok: false, status: 403, reason: "After approval only an administrator can amend a cleaner invoice, because the amendment changes approved money." };
      }
      return { ok: true, needsXeroUpdate: Boolean(facts.xeroBillId) };
    case "PAID_CLAIMED":
      return { ok: false, status: 409, reason: "The payee says this invoice was paid. Confirm the payment or reject the claim before amending it." };
    case "XERO_EXPORTING":
      return { ok: false, status: 409, reason: "A push to Xero is in progress or did not finish. Retry the push or record the payment before amending." };
    case "SENDING":
      return { ok: false, status: 409, reason: "This invoice is waiting for delivery review. Review delivery before amending it." };
    case "CHANGES_REQUESTED":
    case "VOID":
      return { ok: false, status: 409, reason: "This invoice was handed back to the payee, so it cannot be amended. They resend a new invoice." };
    default:
      return { ok: false, status: 409, reason: "This invoice cannot be amended in its current state." };
  }
}

/** One stored bill line (lineData.lines[]), with whatever else was stored on it. */
export type StoredBillLine = Record<string, unknown> & {
  kind?: unknown;
  category?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitAmount?: unknown;
};

/** A readable line: the fields the office edits, plus everything else as stored. */
export type BillLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  /** The rest of the stored line (kind, category, …), kept as it was. */
  extra: Record<string, unknown>;
};

export type BillLineCategory = "LABOUR" | "INSPECTION" | "REIMBURSEMENT";

/** What the office sends for one line of the amended invoice. */
export type AmendLineInput = {
  /** The index of the current line this row edits; null for a new line. */
  sourceIndex: number | null;
  description: string;
  quantity: number;
  unitAmount: number;
  /** New lines only: which Xero account kind it belongs to (default cleaning work). */
  category?: BillLineCategory;
};

export type LineFigures = { description: string; quantity: number; unitAmount: number; amount: number };

export type LineChange =
  | { type: "ADDED"; after: LineFigures }
  | { type: "REMOVED"; before: LineFigures }
  | { type: "CHANGED"; before: LineFigures; after: LineFigures; fields: Array<"description" | "quantity" | "unitAmount"> };

export type AmendmentPlan = {
  afterLines: Array<Record<string, unknown>>;
  changes: LineChange[];
  beforeTotal: number;
  afterTotal: number;
  beforeHours: number;
  afterHours: number;
};

export type AmendmentResult = { ok: true; plan: AmendmentPlan } | { ok: false; reason: string };

export const MAX_LINE_AMOUNT = 100_000;
export const MAX_QUANTITY = 10_000;

export function cents(value: number): number {
  return Math.round(value * 100);
}

export function lineAmount(quantity: number, unitAmount: number): number {
  return cents(quantity * unitAmount) / 100;
}

/** The stored lines, or which ones cannot be read (an amendment never guesses an amount). */
export function readStoredLines(lineData: unknown): { lines: BillLine[]; unreadable: number } {
  const raw = (lineData as { lines?: unknown } | null)?.lines;
  const list = Array.isArray(raw) ? (raw as StoredBillLine[]) : [];
  const lines: BillLine[] = [];
  let unreadable = 0;
  for (const line of list) {
    const unit = typeof line?.unitAmount === "number" && Number.isFinite(line.unitAmount) ? line.unitAmount : null;
    const quantity = line?.quantity === undefined ? 1 : typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : null;
    if (unit === null || quantity === null) {
      unreadable += 1;
      continue;
    }
    const { description, quantity: _q, unitAmount: _u, ...extra } = line;
    lines.push({ description: typeof description === "string" && description.trim() ? description : "Line", quantity, unitAmount: unit, extra });
  }
  return { lines, unreadable };
}

function figures(line: { description: string; quantity: number; unitAmount: number }): LineFigures {
  return { description: line.description, quantity: line.quantity, unitAmount: line.unitAmount, amount: lineAmount(line.quantity, line.unitAmount) };
}

function validLine(line: AmendLineInput): string | null {
  if (!line.description.trim()) return "Every line needs a description.";
  if (line.description.trim().length > 500) return "A line description is at most 500 characters.";
  if (!Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > MAX_QUANTITY) return "Each quantity (or hours) must be more than 0.";
  if (!Number.isFinite(line.unitAmount) || Math.abs(line.unitAmount) > MAX_LINE_AMOUNT) return "Each amount must be a number of dollars and cents.";
  return null;
}

/**
 * The amended lines, the per-line changes and the totals. The new total is
 * the stored total moved by exactly the change in the lines' sum (in cents),
 * so a stored total that already differed from its lines keeps that difference
 * rather than being silently recomputed.
 */
export function planAmendment(input: {
  lineData: unknown;
  storedTotal: number;
  storedHours: number;
  lines: readonly AmendLineInput[];
  /** New total hours for the invoice, or null to keep the stored figure. */
  hours: number | null;
  note: string | null;
}): AmendmentResult {
  const current = readStoredLines(input.lineData);
  if (current.unreadable > 0) {
    return { ok: false, reason: `${current.unreadable} stored line(s) have no readable amount, so this invoice cannot be amended safely. Send it back for changes instead.` };
  }
  if (input.lines.length === 0) return { ok: false, reason: "An amended invoice needs at least one line. To cancel it, reverse it instead." };
  const seen = new Set<number>();
  for (const line of input.lines) {
    const problem = validLine(line);
    if (problem) return { ok: false, reason: problem };
    if (line.sourceIndex !== null) {
      if (!Number.isInteger(line.sourceIndex) || line.sourceIndex < 0 || line.sourceIndex >= current.lines.length || seen.has(line.sourceIndex)) {
        return { ok: false, reason: "The lines changed since you opened this invoice. Reload it and make the change again." };
      }
      seen.add(line.sourceIndex);
    }
  }
  if (input.hours !== null && (!Number.isFinite(input.hours) || input.hours < 0 || input.hours > 10_000)) {
    return { ok: false, reason: "Hours must be 0 or more." };
  }
  const changes: LineChange[] = [];
  const afterLines: Array<Record<string, unknown>> = [];
  for (const line of input.lines) {
    const description = line.description.trim();
    const quantity = line.quantity;
    const unitAmount = cents(line.unitAmount) / 100;
    if (line.sourceIndex === null) {
      const category = line.category ?? "LABOUR";
      afterLines.push({ kind: category === "INSPECTION" ? "INSPECTION" : "CLEANING", category, description, quantity, unitAmount, addedByOffice: true });
      changes.push({ type: "ADDED", after: figures({ description, quantity, unitAmount }) });
      continue;
    }
    const source = current.lines[line.sourceIndex];
    const fields: Array<"description" | "quantity" | "unitAmount"> = [];
    if (source.description !== description) fields.push("description");
    if (source.quantity !== quantity) fields.push("quantity");
    if (cents(source.unitAmount) !== cents(unitAmount)) fields.push("unitAmount");
    afterLines.push({ ...source.extra, description, quantity, unitAmount, ...(fields.length ? { amendedByOffice: true } : {}) });
    if (fields.length) changes.push({ type: "CHANGED", before: figures(source), after: figures({ description, quantity, unitAmount }), fields });
  }
  current.lines.forEach((line, index) => {
    if (!seen.has(index)) changes.unshift({ type: "REMOVED", before: figures(line) });
  });
  const beforeSum = current.lines.reduce((sum, line) => sum + cents(lineAmount(line.quantity, line.unitAmount)), 0);
  const afterSum = afterLines.reduce((sum, line) => sum + cents(lineAmount(line.quantity as number, line.unitAmount as number)), 0);
  const beforeTotal = cents(input.storedTotal) / 100;
  const afterTotal = (cents(input.storedTotal) + afterSum - beforeSum) / 100;
  const afterHours = input.hours === null ? input.storedHours : Math.round(input.hours * 100) / 100;
  const hoursChanged = Math.round(afterHours * 100) !== Math.round(input.storedHours * 100);
  if (changes.length === 0 && !hoursChanged && !input.note) return { ok: false, reason: "Nothing was changed. Edit a line, add or remove one, or change the hours." };
  if (afterTotal < 0) return { ok: false, reason: "The amended total would be below $0.00. Record a deduction as a pay adjustment instead." };
  return { ok: true, plan: { afterLines, changes, beforeTotal, afterTotal, beforeHours: input.storedHours, afterHours } };
}

const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);

function figuresText(line: LineFigures): string {
  return line.quantity === 1 ? money(line.amount) : `${line.quantity} × ${money(line.unitAmount)} = ${money(line.amount)}`;
}

/** Each change in plain words, for the payee's notice, the screens and the PDF. */
export function describeLineChange(change: LineChange): string {
  if (change.type === "ADDED") return `Added “${change.after.description}”: ${figuresText(change.after)}`;
  if (change.type === "REMOVED") return `Removed “${change.before.description}” (was ${figuresText(change.before)})`;
  const parts: string[] = [];
  if (change.fields.includes("description")) parts.push(`description now “${change.after.description}”`);
  if (change.fields.includes("quantity")) parts.push(`quantity ${change.before.quantity} → ${change.after.quantity}`);
  if (change.fields.includes("unitAmount")) parts.push(`unit amount ${money(change.before.unitAmount)} → ${money(change.after.unitAmount)}`);
  return `Changed “${change.before.description}”: ${parts.join(", ")}; line ${money(change.before.amount)} → ${money(change.after.amount)}`;
}

export function describeAmendment(plan: Pick<AmendmentPlan, "changes" | "beforeTotal" | "afterTotal" | "beforeHours" | "afterHours">): string[] {
  const lines = plan.changes.map(describeLineChange);
  if (Math.round(plan.beforeHours * 100) !== Math.round(plan.afterHours * 100)) lines.push(`Hours ${plan.beforeHours.toFixed(2)} → ${plan.afterHours.toFixed(2)}`);
  lines.push(`Total ${money(plan.beforeTotal)} → ${money(plan.afterTotal)}`);
  return lines;
}

export function formatAud(value: number): string {
  return money(value);
}
