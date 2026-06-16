/**
 * SaaS platform plan catalog — what cleaning businesses pay US to use sNeek.
 *
 * This is the source of truth that seeds the `Plan` table and drives feature
 * gating (Phase 1c). It is DISTINCT from the `SubscriptionPlan` model, which is
 * a tenant's own recurring-service plan for THEIR clients.
 *
 * Prices are AUD ex-GST monthly. All tiers include a 30-day, card-not-required
 * free trial. Adjust freely — the admin will be able to edit these once the
 * platform admin console lands; for now editing this file + re-seeding is fine.
 */

export type PlanKey = "starter" | "pro" | "scale";

/**
 * Entitlements gate optional modules + set soft limits. Map to the existing
 * portal-visibility/settings flags at the gating layer (Phase 1c). A `null`
 * limit means unlimited.
 */
export interface PlanEntitlements {
  // Module access
  qa: boolean;
  laundry: boolean;
  inventory: boolean;
  maintenance: boolean;
  payroll: boolean;
  marketing: boolean;
  integrations: boolean; // Xero / Stripe-payments / SMS providers
  selfModification: boolean; // advanced automation/AI ops (future)
  apiAccess: boolean;
  customBranding: boolean;
  // Soft limits (null = unlimited)
  maxStaff: number | null; // cleaners + ops + QA + laundry seats
  maxProperties: number | null;
  maxAdmins: number | null;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  description: string;
  priceCents: number; // AUD cents / month
  currency: "AUD";
  interval: "month";
  trialDays: number;
  sortOrder: number;
  /** Marketing bullet list for the /pricing page. */
  highlights: string[];
  entitlements: PlanEntitlements;
}

export const TRIAL_DAYS = 30;

export const PLANS: Record<PlanKey, PlanDefinition> = {
  starter: {
    key: "starter",
    name: "Starter",
    description: "Run a small cleaning crew: jobs, scheduling, clients and proof-of-clean.",
    priceCents: 4900, // A$49 / month
    currency: "AUD",
    interval: "month",
    trialDays: TRIAL_DAYS,
    sortOrder: 1,
    highlights: [
      "Jobs, scheduling & dispatch",
      "Client & cleaner portals",
      "Photo/video proof + checklists",
      "Quotes & invoices",
      "Up to 3 staff seats",
    ],
    entitlements: {
      qa: false,
      laundry: false,
      inventory: false,
      maintenance: false,
      payroll: false,
      marketing: false,
      integrations: false,
      selfModification: false,
      apiAccess: false,
      customBranding: false,
      maxStaff: 3,
      maxProperties: 50,
      maxAdmins: 1,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    description: "Scale operations: add QA, laundry, inventory, payroll, marketing and integrations.",
    priceCents: 14900, // A$149 / month
    currency: "AUD",
    interval: "month",
    trialDays: TRIAL_DAYS,
    sortOrder: 2,
    highlights: [
      "Everything in Starter",
      "QA inspections & reports",
      "Laundry & inventory tracking",
      "Payroll & timesheets",
      "Marketing, reviews & integrations (Xero, Stripe, SMS)",
      "Custom branding · up to 15 staff",
    ],
    entitlements: {
      qa: true,
      laundry: true,
      inventory: true,
      maintenance: false,
      payroll: true,
      marketing: true,
      integrations: true,
      selfModification: false,
      apiAccess: false,
      customBranding: true,
      maxStaff: 15,
      maxProperties: 500,
      maxAdmins: 3,
    },
  },
  scale: {
    key: "scale",
    name: "Scale",
    description: "For multi-team operators who want every module, API access and priority support.",
    priceCents: 34900, // A$349 / month
    currency: "AUD",
    interval: "month",
    trialDays: TRIAL_DAYS,
    sortOrder: 3,
    highlights: [
      "Everything in Pro",
      "Maintenance & asset tracking",
      "Advanced automation",
      "API access",
      "Unlimited staff & properties",
      "Priority support",
    ],
    entitlements: {
      qa: true,
      laundry: true,
      inventory: true,
      maintenance: true,
      payroll: true,
      marketing: true,
      integrations: true,
      selfModification: true,
      apiAccess: true,
      customBranding: true,
      maxStaff: null,
      maxProperties: null,
      maxAdmins: null,
    },
  },
};

export const DEFAULT_PLAN_KEY: PlanKey = "starter";

export function getPlan(key: string | null | undefined): PlanDefinition {
  if (key && key in PLANS) return PLANS[key as PlanKey];
  return PLANS[DEFAULT_PLAN_KEY];
}

export function listPlans(): PlanDefinition[] {
  return Object.values(PLANS).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** True if the plan's entitlements allow the given module/feature flag. */
export function planAllows(key: string | null | undefined, feature: keyof PlanEntitlements): boolean {
  const value = getPlan(key).entitlements[feature];
  return typeof value === "boolean" ? value : value !== 0;
}

export function formatPlanPrice(plan: PlanDefinition): string {
  const dollars = plan.priceCents / 100;
  return `A$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}/mo`;
}
