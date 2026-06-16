import "server-only";
import type { PrismaClient } from "@prisma/client";
import { MULTITENANCY_ENABLED, TENANT_STRICT } from "@/lib/saas/config";
import { getCurrentOrganizationId, isPlatformAdminContext } from "@/lib/saas/tenant-context";
import { isTenantOwned } from "@/lib/saas/tenant-models";

/**
 * Prisma middleware that enforces row-level tenant isolation by injecting
 * `organizationId` into every query against a tenant-owned model.
 *
 * STATUS: INERT until `SNEEK_MULTITENANCY=1` AND every tenant-owned model has an
 * `organizationId` column (Phase 1b migration). It is NOT registered in lib/db.ts
 * yet. Wire it in (behind the flag) only after the column rollout and the
 * 2-tenant leak audit.
 *
 * Behaviour when enabled and an org context is active:
 *  - reads  (findMany/findFirst/count/aggregate/groupBy): force `where.organizationId`
 *  - findUnique/findUniqueOrThrow: rewritten to findFirst(+OrThrow) so the org
 *    filter can be added (a bare unique where cannot carry extra filters in the
 *    type, though Prisma runs it fine)
 *  - create: stamp `data.organizationId`
 *  - createMany: stamp every row
 *  - update/delete/upsert: force `where.organizationId` (extendedWhereUnique, GA in v5)
 *
 * KNOWN LIMITATIONS — must be covered by the leak audit, not assumed safe:
 *  1. NESTED WRITES: a top-level create/update that nests creates of other
 *     tenant-owned relations does NOT auto-stamp the nested rows. Either pass
 *     organizationId explicitly in those writes or split them. The audit greps
 *     for nested `create:`/`createMany:` on tenant models.
 *  2. RAW QUERIES ($queryRaw/$executeRaw) are NOT intercepted. Audit each one.
 *  3. The Postgres RLS backstop (Phase 2) is what makes (1)/(2) safe by default;
 *     until then, isolation depends on this middleware + code review.
 */

const READ_ACTIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

function forceOrg(where: any, orgId: string) {
  return { ...(where ?? {}), organizationId: orgId };
}

export function registerTenantScoping(prisma: PrismaClient) {
  if (!MULTITENANCY_ENABLED) return prisma;

  prisma.$use(async (params, next) => {
    if (!isTenantOwned(params.model)) {
      return next(params);
    }

    // Platform-admin bypass (migrations, super-admin, cross-tenant billing).
    if (isPlatformAdminContext()) {
      return next(params);
    }

    const orgId = getCurrentOrganizationId();
    if (!orgId) {
      if (TENANT_STRICT) {
        throw new Error(
          `TENANT_CONTEXT_MISSING: query on tenant-owned model "${params.model}" (${params.action}) ` +
            `ran without an organization context. Wrap the request in runWithTenant().`
        );
      }
      return next(params);
    }

    params.args = params.args ?? {};

    switch (params.action) {
      case "findUnique":
      case "findUniqueOrThrow": {
        // Rewrite to findFirst so the non-unique org filter can be applied.
        params.action = params.action === "findUnique" ? "findFirst" : "findFirstOrThrow";
        params.args.where = forceOrg(params.args.where, orgId);
        break;
      }
      case "create": {
        params.args.data = { ...(params.args.data ?? {}), organizationId: orgId };
        break;
      }
      case "createMany": {
        const data = params.args.data;
        params.args.data = Array.isArray(data)
          ? data.map((row: any) => ({ ...row, organizationId: orgId }))
          : { ...(data ?? {}), organizationId: orgId };
        break;
      }
      case "upsert": {
        params.args.where = forceOrg(params.args.where, orgId);
        params.args.create = { ...(params.args.create ?? {}), organizationId: orgId };
        break;
      }
      case "update":
      case "updateMany":
      case "delete":
      case "deleteMany": {
        params.args.where = forceOrg(params.args.where, orgId);
        break;
      }
      default: {
        if (READ_ACTIONS.has(params.action)) {
          params.args.where = forceOrg(params.args.where, orgId);
        }
        break;
      }
    }

    return next(params);
  });

  return prisma;
}
