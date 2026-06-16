/**
 * SaaS feature flags. All default OFF so the platform behaves exactly as the
 * current single-tenant app until each capability is explicitly switched on
 * (and, for tenant isolation, only after the organizationId column rollout +
 * the 2-tenant leak audit have passed).
 */

function flag(name: string): boolean {
  return process.env[name] === "1" || process.env[name] === "true";
}

/**
 * Master switch for row-level tenant isolation. When ON, the Prisma auto-scoping
 * middleware (lib/saas/tenant-prisma.ts) enforces `organizationId` on every
 * tenant-owned model. MUST stay OFF until:
 *   1. every tenant-owned model has an `organizationId` column (Phase 1b migration), and
 *   2. the 2-tenant leak audit passes.
 * Turning it on before (1) makes queries fail loudly (fail-closed), which is by design.
 */
export const MULTITENANCY_ENABLED = flag("SNEEK_MULTITENANCY");

/**
 * When isolation is ON, a query against a tenant-owned model with NO active org
 * context throws instead of silently running unscoped. Keep TRUE in production.
 * Can be relaxed only for controlled migration/backfill scripts that wrap their
 * work in `runAsPlatformAdmin()`.
 */
export const TENANT_STRICT = MULTITENANCY_ENABLED && !flag("SNEEK_TENANT_LENIENT");

/** Public self-serve signup. Gated until isolation is live + audited. */
export const SIGNUP_ENABLED = flag("SNEEK_SIGNUP");

/** Stripe subscription billing. Gated until keys + price ids are configured. */
export const BILLING_ENABLED = flag("SNEEK_BILLING");
