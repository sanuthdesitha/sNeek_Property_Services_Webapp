/**
 * Who may read Insights, and which figures they get.
 *
 *  - ADMIN: everything, independently of operations packs.
 *  - OPS_MANAGER: Insights follows the `reports` feature (the page's feature in
 *    lib/rbac/ops-catalog, enforced by the live session guard). Financial
 *    figures (revenue, cleaner cost, margin, days to pay, overdue) also need
 *    the `finance` feature at read level or above; without it they are left
 *    out of the response on the server, not hidden in the browser. Quality and
 *    time figures still show.
 *  - Every other role (QA inspectors included): refused. The client report
 *    PDFs keep their existing ADMIN / OPS_MANAGER guard.
 *
 * Impersonation and retained accounts are handled by the session guard: the
 * session carries the target's roles, so a target's restrictions apply.
 */
import "server-only";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows, type OpsLevels } from "@/lib/rbac/ops-catalog";
import type { InsightsAccess } from "./types";

export const INSIGHTS_ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER];

/** Pure: null levels means "not an operations-pack subject" (an admin). */
export function insightsAccessFor(levels: OpsLevels | null): InsightsAccess {
  return { finance: levels === null || opsLevelAllows(levels.finance, "GET") };
}

export async function requireInsightsAccess(): Promise<InsightsAccess> {
  const session = await requireRole(INSIGHTS_ROLES);
  const levels = await getOpsAccess(session.user);
  return insightsAccessFor(levels);
}
