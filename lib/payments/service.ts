import { db } from "@/lib/db";
import { GatewayProvider, GatewayStatus } from "@prisma/client";

export interface PaymentGatewayConfig {
  id: string;
  provider: GatewayProvider;
  status: GatewayStatus;
  label: string;
  priority: number;
  credentials: Record<string, unknown>;
  feeRate: number;
  fixedFee: number;
  surchargeEnabled: boolean;
}

export interface PaymentResult {
  ok: boolean;
  paymentId?: string;
  clientSecret?: string;
  checkoutUrl?: string;
  error?: string;
}

export interface PaymentIntentInput {
  amount: number; // in cents
  currency: string;
  invoiceId?: string;
  customerEmail?: string;
  customerName?: string;
  description?: string;
  returnUrl: string;
}

export interface PaymentGatewayAdapter {
  createPaymentIntent(input: PaymentIntentInput): Promise<PaymentResult>;
  confirmPayment(paymentId: string): Promise<{ ok: boolean; error?: string }>;
  refundPayment(paymentId: string, amount?: number): Promise<{ ok: boolean; error?: string }>;
  getPaymentStatus(paymentId: string): Promise<{ status: string; paidAt?: Date }>;
}

/**
 * Get all active payment gateways, ordered by priority.
 */
export async function getActiveGateways(): Promise<PaymentGatewayConfig[]> {
  const gateways = await db.paymentGateway.findMany({
    where: { status: GatewayStatus.ACTIVE },
    orderBy: { priority: "asc" },
  });

  return gateways.map((g) => ({
    id: g.id,
    provider: g.provider as GatewayProvider,
    status: g.status as GatewayStatus,
    label: g.label,
    priority: g.priority,
    credentials: g.credentials as Record<string, unknown>,
    feeRate: g.feeRate,
    fixedFee: g.fixedFee,
    surchargeEnabled: g.surchargeEnabled,
  }));
}

/**
 * Get the primary (highest priority) active gateway.
 */
export async function getPrimaryGateway(): Promise<PaymentGatewayConfig | null> {
  const gateways = await getActiveGateways();
  return gateways[0] ?? null;
}

/**
 * Create a payment adapter for the given gateway config.
 */
export function createPaymentAdapter(gateway: PaymentGatewayConfig): PaymentGatewayAdapter {
  switch (gateway.provider) {
    case GatewayProvider.STRIPE:
      return createStripeAdapter(gateway.credentials as Record<string, string>);
    case GatewayProvider.SQUARE:
      return createSquareAdapter(gateway.credentials as Record<string, string>);
    case GatewayProvider.PAYPAL:
      return createPayPalAdapter(gateway.credentials as Record<string, string>);
    default:
      throw new Error(`Unsupported gateway provider: ${gateway.provider}`);
  }
}

/**
 * Calculate the fee for a payment amount given gateway settings.
 */
export function calculateGatewayFee(amountCents: number, gateway: PaymentGatewayConfig): number {
  const percentageFee = Math.round(amountCents * gateway.feeRate);
  const totalFee = percentageFee + Math.round(gateway.fixedFee * 100);
  return gateway.surchargeEnabled ? totalFee : 0;
}

// ── Stripe Adapter ──
function createStripeAdapter(credentials: Record<string, string>): PaymentGatewayAdapter {
  const secretKey = credentials.secretKey || process.env.STRIPE_SECRET_KEY;

  return {
    async createPaymentIntent(input: PaymentIntentInput): Promise<PaymentResult> {
      if (!secretKey) return { ok: false, error: "Stripe secret key not configured" };

      const res = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          amount: String(input.amount),
          currency: input.currency,
          description: input.description || "sNeek Property Services Payment",
          ...(input.customerEmail ? { receipt_email: input.customerEmail } : {}),
          ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Stripe error: ${body}` };
      }

      const data = await res.json() as { id: string; client_secret: string };
      return { ok: true, paymentId: data.id, clientSecret: data.client_secret };
    },

    async confirmPayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
      if (!secretKey) return { ok: false, error: "Stripe secret key not configured" };

      const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentId}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (!res.ok) return { ok: false, error: "Failed to confirm payment" };
      const data = await res.json() as { status: string };
      return { ok: data.status === "succeeded" };
    },

    async refundPayment(paymentId: string, amount?: number): Promise<{ ok: boolean; error?: string }> {
      if (!secretKey) return { ok: false, error: "Stripe secret key not configured" };

      const params = new URLSearchParams({ payment_intent: paymentId });
      if (amount) params.set("amount", String(amount));

      const res = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Stripe refund error: ${body}` };
      }
      return { ok: true };
    },

    async getPaymentStatus(paymentId: string): Promise<{ status: string; paidAt?: Date }> {
      if (!secretKey) return { status: "unknown" };

      const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentId}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (!res.ok) return { status: "unknown" };
      const data = await res.json() as { status: string; created?: number };
      return {
        status: data.status,
        paidAt: data.created ? new Date(data.created * 1000) : undefined,
      };
    },
  };
}

// ── Square Adapter ──
function createSquareAdapter(credentials: Record<string, string>): PaymentGatewayAdapter {
  const accessToken = credentials.accessToken || process.env.SQUARE_ACCESS_TOKEN;
  const locationId = credentials.locationId || process.env.SQUARE_LOCATION_ID;

  return {
    async createPaymentIntent(input: PaymentIntentInput): Promise<PaymentResult> {
      if (!accessToken || !locationId) return { ok: false, error: "Square credentials not configured" };

      const res = await fetch("https://connect.squareup.com/v2/orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-01-01",
        },
        body: JSON.stringify({
          idempotency_key: `sneek-${input.invoiceId || Date.now()}`,
          order: {
            location_id: locationId,
            line_items: [
              {
                name: input.description || "sNeek Property Services Payment",
                quantity: "1",
                base_price_money: {
                  amount: input.amount,
                  currency: input.currency.toUpperCase(),
                },
              },
            ],
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Square error: ${body}` };
      }

      const data = await res.json() as { order: { id: string } };
      return { ok: true, paymentId: data.order.id };
    },

    async confirmPayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
      if (!accessToken) return { ok: false, error: "Square credentials not configured" };

      const res = await fetch(`https://connect.squareup.com/v2/orders/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Square-Version": "2024-01-01",
        },
      });

      if (!res.ok) return { ok: false, error: "Failed to confirm payment" };
      const data = await res.json() as { order: { state: string } };
      return { ok: data.order?.state === "COMPLETED" };
    },

    async refundPayment(paymentId: string, amount?: number): Promise<{ ok: boolean; error?: string }> {
      if (!accessToken) return { ok: false, error: "Square credentials not configured" };

      const res = await fetch("https://connect.squareup.com/v2/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-01-01",
        },
        body: JSON.stringify({
          idempotency_key: `refund-${paymentId}-${Date.now()}`,
          amount_money: amount ? { amount, currency: "AUD" } : undefined,
          payment_id: paymentId,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Square refund error: ${body}` };
      }
      return { ok: true };
    },

    async getPaymentStatus(paymentId: string): Promise<{ status: string; paidAt?: Date }> {
      if (!accessToken) return { status: "unknown" };

      const res = await fetch(`https://connect.squareup.com/v2/orders/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Square-Version": "2024-01-01",
        },
      });

      if (!res.ok) return { status: "unknown" };
      const data = await res.json() as { order: { state: string; created_at?: string } };
      return {
        status: data.order?.state?.toLowerCase() || "unknown",
        paidAt: data.order?.created_at ? new Date(data.order.created_at) : undefined,
      };
    },
  };
}

// ── PayPal Adapter ──
function createPayPalAdapter(credentials: Record<string, string>): PaymentGatewayAdapter {
  const clientId = credentials.clientId || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = credentials.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
  const baseUrl = credentials.sandbox === "true"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

  async function getAccessToken(): Promise<string | null> {
    if (!clientId || !clientSecret) return null;

    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) return null;
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  return {
    async createPaymentIntent(input: PaymentIntentInput): Promise<PaymentResult> {
      const token = await getAccessToken();
      if (!token) return { ok: false, error: "PayPal credentials not configured" };

      const res = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: input.currency.toUpperCase(),
                value: (input.amount / 100).toFixed(2),
              },
              description: input.description || "sNeek Property Services Payment",
            },
          ],
          application_context: {
            return_url: input.returnUrl,
            cancel_url: input.returnUrl,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `PayPal error: ${body}` };
      }

      const data = await res.json() as { id: string; links: Array<{ rel: string; href: string }> };
      const approveLink = data.links.find((l) => l.rel === "approve");
      return { ok: true, paymentId: data.id, checkoutUrl: approveLink?.href };
    },

    async confirmPayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
      const token = await getAccessToken();
      if (!token) return { ok: false, error: "PayPal credentials not configured" };

      const res = await fetch(`${baseUrl}/v2/checkout/orders/${paymentId}/capture`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `PayPal capture error: ${body}` };
      }

      const data = await res.json() as { status: string };
      return { ok: data.status === "COMPLETED" };
    },

    async refundPayment(paymentId: string, amount?: number): Promise<{ ok: boolean; error?: string }> {
      const token = await getAccessToken();
      if (!token) return { ok: false, error: "PayPal credentials not configured" };

      const res = await fetch(`${baseUrl}/v2/payments/captures/${paymentId}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: amount ? JSON.stringify({
          amount: { value: (amount / 100).toFixed(2), currency_code: "AUD" },
        }) : undefined,
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `PayPal refund error: ${body}` };
      }
      return { ok: true };
    },

    async getPaymentStatus(paymentId: string): Promise<{ status: string; paidAt?: Date }> {
      const token = await getAccessToken();
      if (!token) return { status: "unknown" };

      const res = await fetch(`${baseUrl}/v2/checkout/orders/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return { status: "unknown" };
      const data = await res.json() as { status: string; create_time?: string };
      return {
        status: data.status?.toLowerCase() || "unknown",
        paidAt: data.create_time ? new Date(data.create_time) : undefined,
      };
    },
  };
}
