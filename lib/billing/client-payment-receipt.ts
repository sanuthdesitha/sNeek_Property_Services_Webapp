/**
 * The client's payment receipt: ONE function for a payment recorded by hand
 * ("Record payment") and a payment read from Xero. Same template
 * (`buildClientPaymentReceipt`), same recipient (the client's email), same
 * transactional send through the email chokepoint, so the client's
 * notification settings apply exactly as they always have for receipts.
 *
 * Moved out of `client-invoice-patch.ts`; behaviour for the manual path is
 * unchanged. It now reports what happened instead of returning nothing, so the
 * Xero path can record a failure.
 */
import { db } from "@/lib/db";

export type PaymentReceiptInput = {
  invoiceId: string;
  amount: number;
  method: string;
  paidDate: Date;
  reference: string | null;
};

export type PaymentReceiptOutcome =
  | { outcome: "sent"; externalId: string | null }
  | { outcome: "no-recipient" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; error: string };

/**
 * Email the client that their payment landed.
 *
 * Reads the invoice AFTER the write so the outstanding figure on the receipt is
 * the one that now stands — computing it from the request body would state a
 * balance that was already out of date by the time it was sent.
 */
export async function sendClientPaymentReceipt(input: PaymentReceiptInput): Promise<PaymentReceiptOutcome> {
  const invoice = await db.clientInvoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      invoiceNumber: true,
      totalAmount: true,
      paidAmount: true,
      client: { select: { name: true, email: true } },
    },
  });
  if (!invoice?.client?.email) return { outcome: "no-recipient" };

  const { sendEmailDetailed } = await import("@/lib/notifications/email");
  const { getAppSettings } = await import("@/lib/settings");
  const { buildClientPaymentReceipt } = await import("@/lib/finance/payment-notices");
  const settings = await getAppSettings();

  const email = buildClientPaymentReceipt({
    recipientName: invoice.client.name,
    invoiceNumber: invoice.invoiceNumber,
    amount: input.amount,
    method: input.method,
    paidDate: input.paidDate,
    reference: input.reference,
    companyName: settings.companyName,
    outstanding: Math.max(
      0,
      Number(invoice.totalAmount ?? 0) - Number(invoice.paidAmount ?? 0)
    ),
  });

  const result = await sendEmailDetailed({
    kind: "auto_invoice",
    to: invoice.client.email,
    subject: email.subject,
    html: email.html,
    // A finance document. A stale suppression must not eat a payment receipt.
    transactional: true,
  });
  if (result.ok) return { outcome: "sent", externalId: result.externalId ?? null };
  if (result.skipped) return { outcome: "skipped", reason: result.error ?? "skipped" };
  return { outcome: "failed", error: result.error ?? "Email provider failed." };
}
