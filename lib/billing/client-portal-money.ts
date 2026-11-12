/**
 * The client Money tab's reading of issued invoices (board 4, "Money").
 *
 * Presentation only. Every figure comes from the existing money policies:
 * `invoiceAmountOwing` / `isFullyCredited` (receivables), the one payment-terms
 * rule (`effectivePaymentTermsDays`) and the one due-day rule (`invoiceDueDay`,
 * the day printed on the client's PDF). Nothing here changes what can be paid:
 * `payable` is the same SENT/APPROVED rule the portal and the payment-link
 * route already use.
 *
 * "Paid" is shown only for a PAID invoice, i.e. after the payment is recorded
 * (the provider's confirmation through the webhook, or the office recording
 * it). Returning from the checkout page proves nothing and changes nothing here.
 *
 * Pure: safe in tests.
 */
import { creditedAmountOf, invoiceAmountOwing, isFullyCredited, type CreditNoteFacts } from "@/lib/finance/receivables";
import { effectivePaymentTermsDays, invoiceDueDay } from "@/lib/billing/invoice-due";

export type ClientMoneyState =
  | "DUE"
  | "OVERDUE"
  | "NOT_SENT"
  | "PART_PAID"
  | "PAID"
  | "CREDIT_NOTE"
  | "FULLY_CREDITED"
  | "OTHER";

export interface ClientMoneyInvoiceFacts {
  id: string;
  invoiceNumber: string;
  status: string;
  kind: string;
  totalAmount: number | null;
  paidAmount: number | null;
  paidDate: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  paymentTermsDays: number | null;
  creditNotes?: readonly CreditNoteFacts[] | null;
  /** Lines that bill a clean, and every other line. Null when not read. */
  cleanLineCount?: number | null;
  otherLineCount?: number | null;
}

/** Terms for this client; null when they could not be read (due days then unknown, never guessed). */
export interface ClientMoneyTerms {
  clientTermsDays: number | null;
  organisationDefaultDays: number;
  timezone: string;
}

export interface ClientMoneyRow {
  id: string;
  invoiceNumber: string;
  state: ClientMoneyState;
  totalAmount: number;
  /** What is still owed; 0 for a credit note, a paid or a fully credited invoice. */
  owing: number;
  /** yyyy-MM-dd calendar day; null for credit notes or when terms are unknown. */
  dueDay: string | null;
  /** Due day fixed when sent: an unsent (approved) invoice's day is provisional. */
  dueProvisional: boolean;
  /** Recorded payment day (paidDate, else the record time); only for PAID. */
  paidOn: Date | null;
  createdAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  payable: boolean;
  cleanLineCount: number | null;
  otherLineCount: number | null;
}

export interface ClientMoneyToPay {
  /** Sum still owed on every outstanding invoice. */
  total: number;
  /** The invoice to pay first: overdue, then earliest due, then oldest. */
  primary: ClientMoneyRow | null;
  outstandingCount: number;
}

/** The existing portal rule: a SENT or APPROVED invoice (never a credit note) can be paid online. */
export function isPortalPayable(invoice: Pick<ClientMoneyInvoiceFacts, "status" | "kind">): boolean {
  return invoice.kind !== "CREDIT_NOTE" && (invoice.status === "SENT" || invoice.status === "APPROVED");
}

function stateOf(invoice: ClientMoneyInvoiceFacts, fullyCredited: boolean, overdue: boolean): ClientMoneyState {
  if (invoice.kind === "CREDIT_NOTE") return "CREDIT_NOTE";
  if (invoice.status === "PAID") return "PAID";
  if (fullyCredited) return "FULLY_CREDITED";
  if (invoice.status === "PART_PAID") return "PART_PAID";
  if (invoice.status === "APPROVED") return "NOT_SENT";
  if (invoice.status === "SENT") return overdue ? "OVERDUE" : "DUE";
  return "OTHER";
}

export function buildClientMoneyRow(
  invoice: ClientMoneyInvoiceFacts,
  terms: ClientMoneyTerms | null,
  todayKey: string,
): ClientMoneyRow {
  const creditNote = invoice.kind === "CREDIT_NOTE";
  const owingFacts = {
    totalAmount: invoice.totalAmount,
    paidAmount: invoice.paidAmount,
    creditedAmount: creditNote ? 0 : creditedAmountOf(invoice.creditNotes),
  };
  const fullyCredited = !creditNote && isFullyCredited(owingFacts);
  const settled = creditNote || fullyCredited || invoice.status === "PAID";
  const dueDay = creditNote || !terms
    ? null
    : invoiceDueDay(
        invoice.createdAt,
        effectivePaymentTermsDays({
          invoiceTermsDays: invoice.paymentTermsDays,
          clientTermsDays: terms.clientTermsDays,
          organisationDefaultDays: terms.organisationDefaultDays,
        }),
        terms.timezone,
      );
  const outstanding = !settled && (invoice.status === "SENT" || invoice.status === "PART_PAID");
  const overdue = outstanding && dueDay !== null && dueDay < todayKey;
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    state: stateOf(invoice, fullyCredited, overdue),
    totalAmount: Number(invoice.totalAmount ?? 0),
    owing: settled ? 0 : Number(invoiceAmountOwing(owingFacts).toFixed(2)),
    dueDay,
    dueProvisional: invoice.status === "APPROVED",
    paidOn: invoice.status === "PAID" ? invoice.paidDate ?? invoice.paidAt : null,
    createdAt: invoice.createdAt,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    payable: isPortalPayable(invoice) && !settled,
    cleanLineCount: invoice.cleanLineCount ?? null,
    otherLineCount: invoice.otherLineCount ?? null,
  };
}

const OWING_STATES: ReadonlySet<ClientMoneyState> = new Set<ClientMoneyState>(["DUE", "OVERDUE", "NOT_SENT", "PART_PAID"]);

export function summarizeToPay(rows: readonly ClientMoneyRow[]): ClientMoneyToPay {
  const outstanding = rows.filter((row) => OWING_STATES.has(row.state) && row.owing > 0);
  const ordered = [...outstanding].sort((a, b) => {
    if ((a.state === "OVERDUE") !== (b.state === "OVERDUE")) return a.state === "OVERDUE" ? -1 : 1;
    const dueA = a.dueDay ?? "9999-12-31";
    const dueB = b.dueDay ?? "9999-12-31";
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const total = outstanding.reduce((sum, row) => sum + row.owing, 0);
  return { total: Number(total.toFixed(2)), primary: ordered[0] ?? null, outstandingCount: outstanding.length };
}

/** "14 Nov" from a yyyy-MM-dd calendar day, with no timezone shift. */
export function shortCalendarDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date} ${names[month - 1]}`;
}
