/**
 * "Include payment link" on send (Wave D). The link opens the client portal's
 * invoices page, whose existing "Pay now" control calls the existing
 * payment-link route (POST /api/client/invoices/[id]/payment-link) to start a
 * Stripe checkout for what is still owed. A checkout session itself is not put
 * in the email: it expires, and the amount owed may change before the client
 * opens it.
 *
 * Offered only when that route could work: Stripe is switched on in
 * Integrations AND a Stripe secret key is configured on the server (the same
 * two conditions the route checks). Otherwise the option is disabled with the
 * reason. A credit note never carries one.
 */
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";

export type PaymentLinkAvailability = { available: true } | { available: false; reason: string };

export function stripeSecretConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.trim() || env.STRIPE_API_KEY?.trim());
}

export async function paymentLinkAvailability(kind: string = "INVOICE"): Promise<PaymentLinkAvailability> {
  if (kind === "CREDIT_NOTE") return { available: false, reason: "A credit note asks for no payment." };
  if (!stripeSecretConfigured()) return { available: false, reason: "No payment gateway is configured: the server has no Stripe key." };
  try {
    const settings = await getPhase3IntegrationsSettings();
    if (!settings.stripe.enabled) return { available: false, reason: "Stripe payments are switched off in Settings, Integrations." };
  } catch {
    return { available: false, reason: "The payment settings could not be read." };
  }
  return { available: true };
}

/** The client portal page where the existing Pay now control lives. */
export function clientPaymentPageUrl(origin: string): string {
  return `${origin}/v2/client/finance`;
}

export function paymentLinkHtml(url: string): string {
  const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:14px;">Pay online: <a href="${safe}">open your invoices and choose Pay now</a>.</p>`;
}

/**
 * Where the payment provider sends the client back after checkout (owner
 * decision 2026-11-13): the NEW client finance page. `?paid=1` says the payment
 * was handed to the provider (the invoice shows Paid only once the provider
 * confirms it); `?payment=cancelled` says checkout was left without paying.
 * The classic `/client/finance?paid=1` keeps working for links already sent.
 */
export const CLIENT_PAYMENT_SUCCESS_PATH = "/v2/client/finance?paid=1";
export const CLIENT_PAYMENT_CANCEL_PATH = "/v2/client/finance?payment=cancelled";

export function clientPaymentReturnUrls(
  resolve: (path: string) => string,
  configured: { successUrl?: string | null; cancelUrl?: string | null } = {},
): { successUrl: string; cancelUrl: string } {
  return {
    // An address an administrator typed into Integrations still wins.
    successUrl: configured.successUrl?.trim() || resolve(CLIENT_PAYMENT_SUCCESS_PATH),
    cancelUrl: configured.cancelUrl?.trim() || resolve(CLIENT_PAYMENT_CANCEL_PATH),
  };
}
