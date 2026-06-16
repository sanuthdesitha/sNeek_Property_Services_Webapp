import "server-only";
import { getSession } from "@/lib/auth/session";
import { runWithTenant } from "@/lib/saas/tenant-context";
import { MULTITENANCY_ENABLED } from "@/lib/saas/config";

/**
 * Resolve the active organization from the session and run `fn` inside that
 * tenant context, so the Prisma auto-scoping middleware isolates all DB access.
 *
 * Usage at the edge of a route handler (once Phase 1b is live):
 *   export const GET = (req) => withRequestTenant(() => handler(req));
 *
 * While MULTITENANCY is OFF this is a transparent pass-through, so it is safe to
 * adopt in handlers incrementally before the flag is flipped.
 */
export async function withRequestTenant<T>(fn: () => Promise<T>): Promise<T> {
  if (!MULTITENANCY_ENABLED) return fn();
  const session = await getSession();
  const organizationId = session?.user?.organizationId ?? null;
  if (!organizationId) {
    // No org on the session: platform-level or unauthenticated. The auto-scoper
    // (fail-closed) will reject tenant-model access, which is the intended guard.
    return fn();
  }
  return runWithTenant(organizationId, fn);
}

/** The current request's organization id, or null. */
export async function getRequestOrganizationId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.organizationId ?? null;
}
