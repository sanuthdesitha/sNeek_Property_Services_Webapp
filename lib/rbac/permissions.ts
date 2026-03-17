import { Role } from "@prisma/client";

// ─── Permission map ───────────────────────────────────────
// Each key is a permission slug; value is array of roles that hold it.

export const PERMISSIONS = {
  // Clients
  "clients:read": [Role.ADMIN, Role.OPS_MANAGER],
  "clients:write": [Role.ADMIN, Role.OPS_MANAGER],
  "clients:delete": [Role.ADMIN, Role.OPS_MANAGER],

  // Properties
  "properties:read": [Role.ADMIN, Role.OPS_MANAGER],
  "properties:write": [Role.ADMIN, Role.OPS_MANAGER],
  "properties:delete": [Role.ADMIN, Role.OPS_MANAGER],
  "properties:integration": [Role.ADMIN, Role.OPS_MANAGER],

  // Jobs – admin/ops
  "jobs:read:all": [Role.ADMIN, Role.OPS_MANAGER],
  "jobs:write": [Role.ADMIN, Role.OPS_MANAGER],
  "jobs:assign": [Role.ADMIN, Role.OPS_MANAGER],
  "jobs:delete": [Role.ADMIN],
  "jobs:qa": [Role.ADMIN, Role.OPS_MANAGER],
  // Jobs – cleaner self
  "jobs:read:own": [Role.CLEANER],
  "jobs:start": [Role.CLEANER],
  "jobs:stop": [Role.CLEANER],
  "jobs:submit": [Role.CLEANER],

  // Forms
  "form-templates:read": [Role.ADMIN, Role.OPS_MANAGER],
  "form-templates:write": [Role.ADMIN],

  // Inventory
  "inventory:read": [Role.ADMIN, Role.OPS_MANAGER],
  "inventory:write": [Role.ADMIN],

  // Laundry
  "laundry:read": [Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY],
  "laundry:write": [Role.ADMIN, Role.OPS_MANAGER],
  "laundry:status": [Role.LAUNDRY],

  // Reports
  "reports:read:all": [Role.ADMIN, Role.OPS_MANAGER],
  "reports:read:own": [Role.CLIENT],

  // Quotes + Pricebook
  "pricebook:read": [Role.ADMIN],
  "pricebook:write": [Role.ADMIN],
  "quotes:read": [Role.ADMIN, Role.OPS_MANAGER],
  "quotes:write": [Role.ADMIN, Role.OPS_MANAGER],

  // Notifications
  "notifications:send": [Role.ADMIN, Role.OPS_MANAGER],
  "notifications:log": [Role.ADMIN, Role.OPS_MANAGER],

  // Cases / issues
  "issues:read": [Role.ADMIN, Role.OPS_MANAGER],
  "issues:write": [Role.ADMIN, Role.OPS_MANAGER],

  // Settings (pay rates)
  "pay-rates:write": [Role.ADMIN],

  // Audit logs
  "audit:read": [Role.ADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return allowed.includes(role);
}

export function can(role: Role, ...perms: Permission[]): boolean {
  return perms.every((p) => hasPermission(role, p));
}
