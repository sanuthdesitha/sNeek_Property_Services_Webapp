import "server-only";
import crypto from "crypto";
import { db } from "@/lib/db";
import { OrgStatus, SubscriptionStatus } from "@prisma/client";
import { getPlan } from "@/lib/saas/plans";
import { runAsPlatformAdmin } from "@/lib/saas/tenant-context";

/**
 * Stripe Billing integration for SaaS subscriptions (what tenants pay US).
 * Uses the Stripe REST API over fetch — consistent with the existing payment
 * adapters and avoids a new dependency. Inert unless STRIPE_SECRET_KEY is set
 * (and the SNEEK_BILLING flag is on at the call sites).
 *
 * This is DISTINCT from app/api/webhooks/stripe (which marks client invoices
 * paid). SaaS billing has its own secret + webhook endpoint.
 */

const STRIPE_API = "https://api.stripe.com/v1";

function secretKey(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
}

function billingWebhookSecret(): string {
  return process.env.STRIPE_BILLING_WEBHOOK_SECRET?.trim() || "";
}

export function isBillingConfigured(): boolean {
  return secretKey().length > 0;
}

/** Encode a nested params object into Stripe's bracketed form syntax. */
function encodeForm(obj: Record<string, any>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      parts.push(...encodeForm(value, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object") {
          parts.push(...encodeForm(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

async function stripePost(path: string, params: Record<string, any>): Promise<any> {
  const key = secretKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(params).join("&"),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe error (${res.status})`);
  }
  return json;
}

/** Ensure the org has a Stripe customer, creating one on first use. */
export async function ensureStripeCustomer(org: {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  owner?: { email: string | null } | null;
}): Promise<string> {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const customer = await stripePost("/customers", {
    name: org.name,
    email: org.owner?.email ?? undefined,
    metadata: { organizationId: org.id },
  });
  await runAsPlatformAdmin(() =>
    db.organization.update({ where: { id: org.id }, data: { stripeCustomerId: customer.id } })
  );
  return customer.id as string;
}

/**
 * Create a Checkout Session to start a paid subscription. Called when a trial
 * ends (or the owner upgrades early). Returns the hosted Checkout URL.
 */
export async function createSubscriptionCheckout(opts: {
  organizationId: string;
  customerId: string;
  planKey: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const plan = getPlan(opts.planKey);
  if (!plan.key) throw new Error("Unknown plan.");
  const stripePriceId = await resolvePriceId(opts.planKey);
  const session = await stripePost("/checkout/sessions", {
    mode: "subscription",
    customer: opts.customerId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.organizationId,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    subscription_data: { metadata: { organizationId: opts.organizationId, planKey: opts.planKey } },
    metadata: { organizationId: opts.organizationId, planKey: opts.planKey },
  });
  return { url: session.url as string };
}

/** Create a Billing Portal session so the owner can manage card/plan/cancel. */
export async function createBillingPortalSession(opts: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const session = await stripePost("/billing_portal/sessions", {
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
  return { url: session.url as string };
}

/** The Stripe price id for a plan (from the Plan row, set in the dashboard). */
async function resolvePriceId(planKey: string): Promise<string> {
  const row = await runAsPlatformAdmin(() =>
    db.plan.findUnique({ where: { key: planKey }, select: { stripePriceId: true } })
  );
  if (!row?.stripePriceId) {
    throw new Error(`Plan "${planKey}" has no stripePriceId configured.`);
  }
  return row.stripePriceId;
}

// ── Webhook ─────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyBillingSignature(signatureHeader: string, body: string): boolean {
  const secret = billingWebhookSecret();
  if (!secret) return false;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signature = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!timestamp || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return safeEqual(expected, signature);
}

function mapStripeStatus(stripeStatus: string): { sub: SubscriptionStatus; org: OrgStatus } {
  switch (stripeStatus) {
    case "trialing":
      return { sub: SubscriptionStatus.TRIALING, org: OrgStatus.TRIALING };
    case "active":
      return { sub: SubscriptionStatus.ACTIVE, org: OrgStatus.ACTIVE };
    case "past_due":
      return { sub: SubscriptionStatus.PAST_DUE, org: OrgStatus.PAST_DUE };
    case "unpaid":
      return { sub: SubscriptionStatus.UNPAID, org: OrgStatus.LOCKED };
    case "canceled":
      return { sub: SubscriptionStatus.CANCELED, org: OrgStatus.CANCELED };
    case "incomplete":
    case "incomplete_expired":
      return { sub: SubscriptionStatus.INCOMPLETE, org: OrgStatus.PAST_DUE };
    default:
      return { sub: SubscriptionStatus.PAST_DUE, org: OrgStatus.PAST_DUE };
  }
}

/**
 * Apply a verified Stripe billing event to our Subscription + Organization.
 * Handles the subscription lifecycle + invoice payment results. All writes run
 * as platform-admin (cross-tenant, no request org context).
 */
export async function handleBillingEvent(event: {
  type?: string;
  data?: { object?: Record<string, any> };
}): Promise<void> {
  const obj = event.data?.object ?? {};
  const type = event.type ?? "";

  await runAsPlatformAdmin(async () => {
    if (type === "checkout.session.completed") {
      const organizationId = String(obj.client_reference_id ?? obj.metadata?.organizationId ?? "").trim();
      const stripeSubscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      if (!organizationId) return;
      await db.organization.update({
        where: { id: organizationId },
        data: {
          status: OrgStatus.ACTIVE,
          stripeCustomerId: customerId ?? undefined,
        },
      });
      await db.subscription.update({
        where: { organizationId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: stripeSubscriptionId ?? undefined,
        },
      });
      return;
    }

    if (type.startsWith("customer.subscription.")) {
      const organizationId = String(obj.metadata?.organizationId ?? "").trim();
      if (!organizationId) return;
      const status = mapStripeStatus(String(obj.status ?? ""));
      const currentPeriodEnd =
        typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000) : null;
      await db.organization.update({ where: { id: organizationId }, data: { status: status.org } });
      await db.subscription.update({
        where: { organizationId },
        data: {
          status: status.sub,
          currentPeriodEnd: currentPeriodEnd ?? undefined,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
          stripeSubscriptionId: typeof obj.id === "string" ? obj.id : undefined,
        },
      });
      return;
    }

    if (type === "invoice.payment_failed") {
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      if (!customerId) return;
      const org = await db.organization.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) return;
      await db.organization.update({ where: { id: org.id }, data: { status: OrgStatus.PAST_DUE } });
      await db.subscription.update({
        where: { organizationId: org.id },
        data: { status: SubscriptionStatus.PAST_DUE },
      });
      return;
    }

    if (type === "invoice.paid") {
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      if (!customerId) return;
      const org = await db.organization.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) return;
      await db.organization.update({ where: { id: org.id }, data: { status: OrgStatus.ACTIVE } });
      await db.subscription.update({
        where: { organizationId: org.id },
        data: { status: SubscriptionStatus.ACTIVE },
      });
    }
  });
}
