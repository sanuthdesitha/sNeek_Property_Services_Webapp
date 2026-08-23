/**
 * TELLING SOMEONE THEIR MONEY MOVED.
 *
 * Neither direction did this. Recording a payment against a client invoice sent
 * nothing, so a client who paid had no confirmation it had been applied — their
 * next statement was the first chance to discover it had not. Marking a payee
 * invoice PAID also sent nothing: somebody did the work, invoiced for it, and
 * money appeared in their account with no idea which invoice it settled or
 * whether it was the whole amount.
 *
 * The second is the one people actually chase. A cleaner paid $940 with no
 * breakdown cannot tell whether their fuel claim was included, so they ask — and
 * answering that by hand, every fortnight, costs more than the email does.
 *
 * TWO DIFFERENT DOCUMENTS, deliberately:
 *
 *   RECEIPT    — to a client. "We have received this from you." It states what
 *                is still outstanding, because a part payment that reads like a
 *                full one is how an invoice quietly stops being chased.
 *   REMITTANCE — to a payee. "We have sent this to you." Standard practice when
 *                paying a contractor, and the thing they reconcile against.
 *
 * PURE — no database, no sending. The routes own delivery so a mail failure can
 * be isolated from the money write, and so the wording can be tested without one.
 */

const SYDNEY = "Australia/Sydney";

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  CASH: "Cash",
  STRIPE: "Card (Stripe)",
  XERO: "Xero",
  MANUAL: "Marked as paid",
  OTHER: "Other",
};

function money(value: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    Number(value ?? 0)
  );
}

function day(value: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PaymentNoticeInput {
  recipientName: string | null;
  invoiceNumber: string | null;
  amount: number;
  method: string;
  paidDate: Date;
  reference?: string | null;
  companyName: string;
}

/**
 * Receipt to a client for money received.
 *
 * `outstanding` is required rather than optional. A part payment that reads like
 * a full one is exactly how an invoice stops being chased by both sides at once,
 * so the remaining balance appears on every receipt — including when it is zero,
 * which is the reassurance the client is actually looking for.
 */
export function buildClientPaymentReceipt(
  input: PaymentNoticeInput & { outstanding: number }
): { subject: string; html: string } {
  const settled = input.outstanding <= 0.005;
  const label = input.invoiceNumber ? ` ${input.invoiceNumber}` : "";

  return {
    subject: settled
      ? `Payment received — invoice${label} is settled`
      : `Part payment received — invoice${label}`,
    html: [
      `<p>Hi ${escapeHtml(input.recipientName ?? "there")},</p>`,
      `<p>Thank you — we have received ${money(input.amount)} on ${escapeHtml(day(input.paidDate))}`,
      input.invoiceNumber
        ? ` against invoice <strong>${escapeHtml(input.invoiceNumber)}</strong>`
        : "",
      `.</p>`,
      `<p><strong>Method:</strong> ${escapeHtml(PAYMENT_METHOD_LABELS[input.method] ?? input.method)}`,
      input.reference ? `<br/><strong>Reference:</strong> ${escapeHtml(input.reference)}` : "",
      `</p>`,
      settled
        ? `<p>Nothing further is outstanding on this invoice.</p>`
        : `<p><strong>Still outstanding: ${money(input.outstanding)}.</strong></p>`,
      `<p>— ${escapeHtml(input.companyName)}</p>`,
    ].join(""),
  };
}

/**
 * Remittance advice to a payee for money sent.
 *
 * Says what it covers, not just how much. "We paid you $940" answers the wrong
 * question — the one they have is whether the extras were included, and a
 * remittance that cannot answer it produces the very message it was meant to
 * save.
 */
export function buildPayeeRemittanceAdvice(
  input: PaymentNoticeInput & {
    periodStart: Date;
    periodEnd: Date;
    /** Where it landed, when the office recorded one. */
    bankAccount?: string | null;
    note?: string | null;
  }
): { subject: string; html: string } {
  const label = input.invoiceNumber ? ` — ${input.invoiceNumber}` : "";

  return {
    subject: `Payment sent${label}`,
    html: [
      `<p>Hi ${escapeHtml(input.recipientName ?? "there")},</p>`,
      `<p>${money(input.amount)} has been paid to you on ${escapeHtml(day(input.paidDate))}`,
      input.invoiceNumber ? ` for invoice <strong>${escapeHtml(input.invoiceNumber)}</strong>` : "",
      `.</p>`,
      `<p><strong>Period covered:</strong> ${escapeHtml(day(input.periodStart))} – ${escapeHtml(day(input.periodEnd))}`,
      `<br/><strong>Method:</strong> ${escapeHtml(PAYMENT_METHOD_LABELS[input.method] ?? input.method)}`,
      input.bankAccount ? `<br/><strong>To:</strong> ${escapeHtml(input.bankAccount)}` : "",
      input.reference ? `<br/><strong>Reference:</strong> ${escapeHtml(input.reference)}` : "",
      `</p>`,
      input.note ? `<p><strong>Note:</strong> ${escapeHtml(input.note)}</p>` : "",
      `<p>This covers everything on that invoice — the jobs, and any extras, inspections or shopping that were on it. If something you expected is missing, it was not on this invoice and will appear on your next one.</p>`,
      `<p>— ${escapeHtml(input.companyName)}</p>`,
    ].join(""),
  };
}
