/**
 * The job page's Money summary (right rail and key facts).
 *
 * Honest states, as drawn: "Not enough data" when a figure cannot be worked
 * out (never zero), "Estimate" until payroll settles pay from clocked time,
 * "Locked" once the charge sits on an issued invoice. The inputs are the same
 * ones payroll and the pay ledger read (custom payout replaces hours × rate;
 * transport is added on top); the canonical per-payee total stays in the pay
 * ledger (JobPayCard), which this does not replace.
 *
 * Fixes a problem in the old Money tab: a cleaner with no rate or no hours was
 * counted as $0, so pay and margin looked known (and margin too high).
 */

export const NOT_ENOUGH_DATA = "Not enough data";

export type MoneyFigure =
  | { kind: "amount"; amount: number }
  | { kind: "unknown"; reason: string };

export type JobMoneyAssignment = {
  userId: string;
  name: string;
  isPrimary: boolean;
  payRate: number | null;
};

export type JobPayLine = {
  userId: string;
  name: string;
  isPrimary: boolean;
  /** Base pay before transport, or unknown. */
  base: MoneyFigure;
  /** How the base was set, in words ("$36.50/h × 2.5 h", "Fixed pay", "Rate or hours missing"). */
  basis: string;
  transport: number;
};

export type JobInvoiceCharge = {
  invoiceNumber: string | null;
  status: string;
  /** The job's lines on that invoice, summed. */
  lineTotal: number;
};

export type JobMoneyInput = {
  fixedPrice: number | null;
  assignments: JobMoneyAssignment[];
  actualHours: number | null;
  estimatedHours: number | null;
  cleanerPayouts: Record<string, number>;
  transportAllowances: Record<string, number>;
  /** The live invoice the job is on, if any. */
  liveInvoice: JobInvoiceCharge | null;
};

export type JobChargeState = "priced" | "rate-card" | "draft-invoice" | "locked";

export type JobMoneySummary = {
  charge: MoneyFigure;
  chargeState: JobChargeState;
  pay: MoneyFigure;
  /** True while pay is worked out from rates and hours rather than settled. */
  payIsEstimate: boolean;
  margin: MoneyFigure;
  marginPercent: number | null;
  payHours: number | null;
  payLines: JobPayLine[];
};

const ISSUED_INVOICE_STATUSES = new Set(["APPROVED", "SENT", "PART_PAID", "PAID"]);

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function payLine(assignment: JobMoneyAssignment, input: JobMoneyInput, payHours: number | null): JobPayLine {
  const custom = input.cleanerPayouts[assignment.userId];
  const transport = input.transportAllowances[assignment.userId] ?? 0;
  const common = { userId: assignment.userId, name: assignment.name, isPrimary: assignment.isPrimary, transport };
  if (typeof custom === "number") {
    return { ...common, base: { kind: "amount", amount: custom }, basis: "Fixed pay" };
  }
  if (assignment.payRate != null && payHours != null) {
    return {
      ...common,
      base: { kind: "amount", amount: roundCents(assignment.payRate * payHours) },
      basis: `${formatMoney(assignment.payRate)}/h × ${payHours} h`,
    };
  }
  const missing = assignment.payRate == null ? "No pay rate" : "No hours";
  return { ...common, base: { kind: "unknown", reason: missing }, basis: missing };
}

function chargeFor(input: JobMoneyInput): { charge: MoneyFigure; chargeState: JobChargeState } {
  const invoice = input.liveInvoice;
  if (invoice && ISSUED_INVOICE_STATUSES.has(invoice.status)) {
    return { charge: { kind: "amount", amount: invoice.lineTotal }, chargeState: "locked" };
  }
  if (invoice) {
    return { charge: { kind: "amount", amount: invoice.lineTotal }, chargeState: "draft-invoice" };
  }
  if (input.fixedPrice != null) return { charge: { kind: "amount", amount: input.fixedPrice }, chargeState: "priced" };
  return { charge: { kind: "unknown", reason: "No rate on the job; billed from the rate card" }, chargeState: "rate-card" };
}

export function summarizeJobMoney(input: JobMoneyInput): JobMoneySummary {
  const payHours = input.actualHours ?? input.estimatedHours ?? null;
  const payLines = input.assignments.map((assignment) => payLine(assignment, input, payHours));
  const { charge, chargeState } = chargeFor(input);

  let pay: MoneyFigure;
  if (payLines.length === 0) {
    pay = { kind: "unknown", reason: NOT_ENOUGH_DATA };
  } else if (payLines.some((line) => line.base.kind === "unknown")) {
    pay = { kind: "unknown", reason: NOT_ENOUGH_DATA };
  } else {
    const total = payLines.reduce((sum, line) => sum + (line.base.kind === "amount" ? line.base.amount : 0) + line.transport, 0);
    pay = { kind: "amount", amount: roundCents(total) };
  }

  let margin: MoneyFigure = { kind: "unknown", reason: NOT_ENOUGH_DATA };
  let marginPercent: number | null = null;
  if (charge.kind === "amount" && pay.kind === "amount") {
    margin = { kind: "amount", amount: roundCents(charge.amount - pay.amount) };
    marginPercent = charge.amount > 0 ? Math.round(((charge.amount - pay.amount) / charge.amount) * 100) : null;
  }

  return { charge, chargeState, pay, payIsEstimate: true, margin, marginPercent, payHours, payLines };
}

/** "$245.00" or the unknown reason, for plain text slots. */
export function moneyText(figure: MoneyFigure): string {
  return figure.kind === "amount" ? formatMoney(figure.amount) : figure.reason;
}
