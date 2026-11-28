/**
 * Who sees which register source (pilot "All issues register"). The register
 * route itself is in the quality pack; each source is listed only when the
 * viewer's packs would let them open that source's own list, so the register
 * never shows an operations manager records their packs keep from them.
 * ADMIN (levels null) sees every source, independent of packs.
 *
 * Operations managers have no per-property scope in this app (packs only), so
 * there is no property scope to apply.
 *
 * Pure: the same rule on the server page and in the route.
 */
import { canUseOpsPath, type OpsLevels } from "@/lib/rbac/ops-catalog";
import { REGISTER_SOURCES, type RegisterSource } from "./model";

/** The list each source already has; its pack decides whether the source is listed. */
export const REGISTER_SOURCE_PATHS: Record<RegisterSource, string> = {
  QA_INSPECTION: "/api/admin/quality/issues",
  CLIENT_COMPLAINT: "/api/admin/cases",
  CLEANER_REPORT: "/api/admin/cases",
  OFFICE: "/api/admin/cases",
  AUTOMATIC: "/api/admin/cases",
  DAMAGE: "/api/admin/damage",
  MAINTENANCE: "/api/admin/maintenance",
  STOCK: "/api/admin/inventory",
};

/** Logging by hand creates a case (IssueTicket) from the Quality hub. */
export const REGISTER_LOG_PATHS = ["/api/admin/quality/register", "/api/admin/cases"] as const;

export function registerAllowedSources(levels: OpsLevels | null): Set<RegisterSource> {
  return new Set(REGISTER_SOURCES.filter((source) => levels === null || canUseOpsPath(levels, REGISTER_SOURCE_PATHS[source])));
}

export function registerCanLog(levels: OpsLevels | null): boolean {
  return levels === null || REGISTER_LOG_PATHS.every((path) => canUseOpsPath(levels, path, "POST"));
}
