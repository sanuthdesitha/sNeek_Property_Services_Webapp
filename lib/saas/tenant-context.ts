import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request tenant context, carried via AsyncLocalStorage so any code path —
 * route handler, service function, nested call — can read the current
 * organization without threading it through every signature. The Prisma
 * auto-scoping middleware reads this to inject `organizationId` filters.
 *
 * Set it once at the edge of a request (after resolving the session's org) with
 * `runWithTenant(...)`. Background workers, which run outside a request, must
 * iterate organizations explicitly and wrap each org's work in `runWithTenant`.
 */

export interface TenantContext {
  organizationId: string;
  /** When true, auto-scoping is bypassed (platform-admin / cross-tenant ops). */
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the given org as the active tenant for all DB access inside it.
 *
 * IMPORTANT: `fn` must AWAIT its async work internally. Prisma queries execute
 * lazily on await, so `runWithTenant(org, () => prisma.x.findMany())` and then
 * awaiting the returned promise OUTSIDE will execute the query after this async
 * context has exited (the scoping middleware would see no org → fail-closed).
 * Route handlers wrapped as `withRequestTenant(() => handler(req))` are fine
 * because the handler awaits its own queries inside.
 */
export function runWithTenant<T>(organizationId: string, fn: () => T): T {
  return storage.run({ organizationId }, fn);
}

/**
 * Run `fn` with tenant scoping disabled (sees all orgs). Use only for trusted
 * platform-level operations: migrations, backfills, the super-admin console,
 * cross-tenant billing reconciliation. Never reachable from tenant routes.
 */
export function runAsPlatformAdmin<T>(fn: () => T): T {
  return storage.run({ organizationId: "__platform__", bypass: true }, fn);
}

/** The active tenant context, or undefined if none is set. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** The active organization id, or null when there is no tenant context. */
export function getCurrentOrganizationId(): string | null {
  const ctx = storage.getStore();
  if (!ctx || ctx.bypass) return null;
  return ctx.organizationId;
}

/** True when the current context is an explicit platform-admin bypass. */
export function isPlatformAdminContext(): boolean {
  return storage.getStore()?.bypass === true;
}
