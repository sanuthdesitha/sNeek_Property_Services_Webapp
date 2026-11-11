/**
 * Applying a completed Stripe Checkout payment to a client invoice.
 *
 * Before (pre-existing problem, fixed 2026-11-11): the webhook marked the
 * invoice PAID with paidAmount = the invoice total whatever was charged, so a
 * part-paid invoice or one reduced by credit notes recorded more money than
 * arrived, and a PART_PAID invoice was never updated at all. The checkout is
 * created for "owing after credits" (payment-link route), so the amount charged
 * is what is recorded, and the invoice is PAID only when payments plus
 * approved/sent credits reach its total: the one owing rule
 * (lib/finance/receivables), the same rule the "Record payment" path applies.
 *
 * Idempotent: Stripe retries webhooks, so a checkout session is recorded once
 * (its id is kept on the metadata.payments[] ledger entry).
 */
import { ClientInvoiceStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { creditedAmountOf } from "@/lib/finance/receivables";

export type CheckoutSessionFacts = {
  invoiceId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
  /** Amount charged in cents, or null when Stripe did not say. */
  amountTotalCents: number | null;
  /** Stripe's payment_status, when present. */
  paymentStatus: string | null;
};

export type CheckoutApplyResult =
  | { outcome: "recorded"; status: ClientInvoiceStatus; paidAmount: number }
  | { outcome: "duplicate" | "not-payable"; reason: string }
  | { outcome: "unreadable" | "not-paid"; reason: string };

/** Payable states: issued or draft invoices not yet settled or cancelled. */
const PAYABLE: ClientInvoiceStatus[] = [
  ClientInvoiceStatus.DRAFT,
  ClientInvoiceStatus.APPROVED,
  ClientInvoiceStatus.SENT,
  ClientInvoiceStatus.PART_PAID,
];

/** The facts a checkout.session.completed object carries; null without an invoice id. */
export function readCheckoutSession(object: Record<string, unknown>): CheckoutSessionFacts | null {
  const metadata = object.metadata && typeof object.metadata === "object" ? (object.metadata as Record<string, unknown>) : {};
  const invoiceId = String(metadata.invoiceId ?? "").trim();
  if (!invoiceId) return null;
  const amount = object.amount_total;
  return {
    invoiceId,
    sessionId: typeof object.id === "string" ? object.id : null,
    paymentIntentId: typeof object.payment_intent === "string" ? object.payment_intent : null,
    amountTotalCents: typeof amount === "number" && Number.isInteger(amount) && amount > 0 ? amount : null,
    paymentStatus: typeof object.payment_status === "string" ? object.payment_status : null,
  };
}

function ledgerOf(metadata: Prisma.JsonValue | null): Array<Record<string, unknown>> {
  const payments = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).payments : null;
  return Array.isArray(payments) ? (payments as Array<Record<string, unknown>>) : [];
}

export async function applyStripeCheckoutPayment(session: CheckoutSessionFacts, now: Date = new Date()): Promise<CheckoutApplyResult> {
  // A checkout can complete before an asynchronous payment clears.
  if (session.paymentStatus && session.paymentStatus !== "paid") {
    return { outcome: "not-paid", reason: `Stripe reports payment_status "${session.paymentStatus}".` };
  }
  // Never assume the whole invoice was paid when Stripe does not say how much.
  if (session.amountTotalCents === null) {
    return { outcome: "unreadable", reason: "Stripe did not report the amount charged." };
  }
  const charged = session.amountTotalCents / 100;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${session.invoiceId} FOR UPDATE`;
    const invoice = await tx.clientInvoice.findUnique({
      where: { id: session.invoiceId },
      select: { id: true, kind: true, status: true, totalAmount: true, paidAmount: true, paidAt: true, metadata: true },
    });
    if (!invoice || invoice.kind !== "INVOICE") return { outcome: "not-payable", reason: "No payable invoice with this id." } as const;
    const ledger = ledgerOf(invoice.metadata);
    const seen = ledger.some(
      (entry) =>
        (session.sessionId && entry.stripeSessionId === session.sessionId) ||
        (session.paymentIntentId && entry.stripePaymentIntentId === session.paymentIntentId),
    );
    if (seen) return { outcome: "duplicate", reason: "This checkout was already recorded." } as const;
    if (!PAYABLE.includes(invoice.status)) return { outcome: "not-payable", reason: `The invoice is ${invoice.status}.` } as const;

    const credited = creditedAmountOf(
      await tx.clientInvoice.findMany({ where: { creditsInvoiceId: invoice.id }, select: { status: true, totalAmount: true } }),
    );
    const paidAmount = Number((Number(invoice.paidAmount ?? 0) + charged).toFixed(2));
    const settled = paidAmount + credited + 0.005 >= Number(invoice.totalAmount ?? 0);
    const status = settled ? ClientInvoiceStatus.PAID : ClientInvoiceStatus.PART_PAID;
    const metadata = invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata) ? invoice.metadata : {};
    await tx.clientInvoice.update({
      where: { id: invoice.id },
      data: {
        status,
        paidAmount,
        paidDate: now,
        ...(settled ? { paidAt: invoice.paidAt ?? now } : {}),
        paymentMethod: "STRIPE",
        ...(session.paymentIntentId ? { paymentReference: session.paymentIntentId, stripePaymentIntentId: session.paymentIntentId } : {}),
        metadata: {
          ...(metadata as Prisma.JsonObject),
          payments: [
            ...ledger,
            {
              amount: charged,
              method: "STRIPE",
              reference: session.paymentIntentId,
              paidDate: now.toISOString(),
              recordedAt: now.toISOString(),
              recordedByName: "Stripe",
              source: "STRIPE",
              stripeSessionId: session.sessionId,
              stripePaymentIntentId: session.paymentIntentId,
            },
          ] as Prisma.JsonArray,
        },
      },
    });
    return { outcome: "recorded", status, paidAmount } as const;
  });
}
