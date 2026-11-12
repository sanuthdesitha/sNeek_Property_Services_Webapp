/**
 * "What each role can do by default": the read-only reference shown on
 * Settings › Access and permissions. It restores the old Roles settings
 * reference (git 8c753d3 components/v2/admin/settings/roles-section.tsx:
 * portal-role summaries and the base permission matrix) and corrects what the
 * 2026-11 access model made untrue there:
 *
 * - An operations manager's office access is decided per area on this screen.
 *   With no preset or area levels, every area is at Manage (resolveAccessLevels
 *   on an empty policy), so the matrix's Ops manager column is generated from
 *   that default and from the area each permission belongs to.
 * - Deleting jobs or clients and archiving properties are sensitive actions:
 *   they need the area at Full (or an explicit grant) and the person's own PIN,
 *   so they are no longer a plain Ops manager tick.
 * - A permission the base map keeps for administrators is still refused to an
 *   operations manager by the route's role guard; area levels only narrow it.
 *
 * Plain module (no "use client", no server imports): the screen and the tests
 * read the same values.
 */
import { Role } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { ADMIN_ONLY_ACTIONS, capabilityDefinition, type CapabilityKey } from "./capabilities";
import { ACCESS_LEVEL_LABELS, OPS_FEATURES, type AccessLevel, type OpsFeature } from "./ops-catalog";
import { EMPTY_OPS_POLICY, resolveAccessLevels } from "./ops-policy";
import { PERMISSIONS, type Permission } from "./permissions";

/** Columns, in the old table's order. */
export const REFERENCE_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.OPS_MANAGER,
  Role.QA_INSPECTOR,
  Role.CLEANER,
  Role.CLIENT,
  Role.LAUNDRY,
  Role.MAINTENANCE,
  Role.VA,
];

/** The level an operations manager with no preset or area levels has in every area. */
export function defaultOpsManagerLevels(): Record<OpsFeature, AccessLevel> {
  return resolveAccessLevels(EMPTY_OPS_POLICY, "role-reference:unassigned");
}

function opsDefaultSummary(): string {
  const levels = defaultOpsManagerLevels();
  const values = Object.values(levels);
  const allSame = values.every((value) => value === values[0]);
  const levelText = allSame
    ? `${ACCESS_LEVEL_LABELS[values[0]]} in every office area (${values.length})`
    : `${values.filter((value) => value !== "off").length} of ${values.length} office areas`;
  return `${levelText} until a preset or area levels are set on this screen. Sensitive actions need Full and the person's own PIN; administrator capabilities are off until an administrator grants them.`;
}

/** One line per role. The old summaries, corrected for the current access model. */
export function roleSummaries(): Record<Role, string> {
  return {
    [Role.ADMIN]: "Everything, including settings, pricing, security and access. Presets and area levels never limit an administrator.",
    [Role.OPS_MANAGER]: opsDefaultSummary(),
    [Role.QA_INSPECTOR]: "Claimable QA queue, inspections, and feedback to cleaners",
    [Role.CLEANER]: "Assigned jobs, form submission, uploads, and time logs",
    [Role.CLIENT]: "Own properties and reports only",
    [Role.LAUNDRY]: "Laundry week schedule and ready queue",
    [Role.MAINTENANCE]: "Assigned repair jobs, access details, and on-site visit tracking",
    [Role.VA]: "Acts for a client, limited to what that client's assistant team allows",
  };
}

/** The office area each office permission belongs to ("owner" = administrators only). */
const PERMISSION_AREA: Partial<Record<Permission, OpsFeature | "owner">> = {
  "clients:read": "clients",
  "clients:write": "clients",
  "clients:delete": "clients",
  "properties:read": "properties",
  "properties:write": "properties",
  "properties:delete": "properties",
  "properties:integration": "properties",
  "jobs:read:all": "jobs",
  "jobs:write": "jobs",
  "jobs:assign": "jobs",
  "jobs:delete": "jobs",
  "jobs:qa": "quality",
  "form-templates:read": "forms",
  "form-templates:write": "forms",
  "inventory:read": "inventory",
  "inventory:write": "inventory",
  "laundry:read": "laundry",
  "laundry:write": "laundry",
  "reports:read:all": "reports",
  "pricebook:read": "pricing",
  "pricebook:write": "pricing",
  "quotes:read": "quotes",
  "quotes:write": "quotes",
  "notifications:send": "communications",
  "notifications:log": "communications",
  "issues:read": "cases",
  "issues:write": "cases",
  "pay-rates:write": "pricing",
  "audit:read": "owner",
};

/** Office permissions that are sensitive actions now (Full level plus the person's PIN). */
const SENSITIVE_PERMISSION: Partial<Record<Permission, CapabilityKey>> = {
  "jobs:delete": "jobs.delete",
  "clients:delete": "clients.delete",
  "properties:delete": "properties.archive",
};

export type ReferenceCell =
  | { kind: "granted" }
  | { kind: "not-granted" }
  /** Operations manager: comes with the area's default level. */
  | { kind: "area-default"; area: string; level: string }
  /** Operations manager: the area is Off by default. */
  | { kind: "area-off"; area: string }
  /** Operations manager: needs the area at Full and their own PIN. */
  | { kind: "needs-full"; area: string; capability: string }
  | { kind: "admin-only" };

export type ReferenceRow = { permission: Permission; cells: Record<Role, ReferenceCell> };

const AREA_LABEL = new Map<string, string>(OPS_FEATURES.map((feature) => [feature.key, feature.label]));

/**
 * Area levels only ever narrow the role guard (ops-catalog: "an additional
 * restriction, never a replacement"). So a permission the base map keeps for
 * administrators stays "Admin only", unless it is one of the sensitive actions
 * an operations manager can now be given through Full.
 */
function opsManagerCell(permission: Permission, holders: ReadonlySet<Role>): ReferenceCell {
  const area = PERMISSION_AREA[permission];
  const sensitive = SENSITIVE_PERMISSION[permission];
  if (area && area !== "owner" && sensitive) {
    return { kind: "needs-full", area: AREA_LABEL.get(area) ?? area, capability: capabilityDefinition(sensitive).label };
  }
  if (!holders.has(Role.OPS_MANAGER)) return holders.has(Role.ADMIN) ? { kind: "admin-only" } : { kind: "not-granted" };
  if (!area || area === "owner") return { kind: "admin-only" };
  const areaLabel = AREA_LABEL.get(area) ?? area;
  const level = defaultOpsManagerLevels()[area];
  if (level === "off") return { kind: "area-off", area: areaLabel };
  return { kind: "area-default", area: areaLabel, level: ACCESS_LEVEL_LABELS[level] };
}

/** The base permission matrix, one row per permission in lib/rbac/permissions.ts. */
export function referenceRows(): ReferenceRow[] {
  return (Object.keys(PERMISSIONS) as Permission[]).map((permission) => {
    const holders = new Set<Role>(PERMISSIONS[permission] as readonly Role[]);
    const cells = Object.fromEntries(
      REFERENCE_ROLES.map((role): [Role, ReferenceCell] => {
        if (role === Role.OPS_MANAGER) return [role, opsManagerCell(permission, holders)];
        return [role, holders.has(role) ? { kind: "granted" } : { kind: "not-granted" }];
      }),
    ) as Record<Role, ReferenceCell>;
    return { permission, cells };
  });
}

export function referenceRoleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export { ADMIN_ONLY_ACTIONS };
