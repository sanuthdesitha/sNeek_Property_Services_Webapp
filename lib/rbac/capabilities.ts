/**
 * ONE typed catalog of fine-grained office capabilities (2026-11 access
 * redesign). Plain module: no "use client", no server imports, so pages,
 * routes and the access screen read the same values.
 *
 * Every capability belongs to one ops area and one tier:
 * - "view":   comes with View. Shown for information; not switchable.
 * - "manage": comes with Manage. An administrator can switch it OFF for a
 *             person or preset; switching it on never goes past the area level.
 * - "full":   a sensitive action. Comes with Full (or an explicit grant kept
 *             from the earlier screen) and is still verified with the
 *             person's own PIN or password at the moment of use.
 *
 * `enforcedAt` names the server enforcement point that calls the shared
 * evaluator (`lib/rbac/can.ts`). The area of each capability is the area the
 * enforcement point's route already belongs to in `ops-catalog.ts`, so a
 * capability can only narrow what the route guard already allows.
 */
import type { SensitiveAction } from "@/lib/security/sensitive-actions";
import type { OpsFeature } from "./ops-catalog";

export type CapabilityTier = "view" | "manage" | "full";

export type CapabilityDefinition = {
  key: string;
  area: OpsFeature;
  label: string;
  tier: CapabilityTier;
  /** The existing sensitive-action grant this capability is (tier "full" only). */
  sensitiveAction?: SensitiveAction;
  /** Plain-language line for "What <name> can do" when allowed. */
  canText: string;
  /** Plain-language line for the "Cannot" list when refused. */
  cannotText: string;
  /** The server enforcement point (documentation and tests). */
  enforcedAt: string;
  /** A short extra line under the switch. */
  note?: string;
};

export const CAPABILITIES = [
  // Jobs and assignments
  { key: "jobs.cancel", area: "jobs", label: "Cancel jobs", tier: "manage", canText: "Cancel jobs (with a reason)", cannotText: "Cancel jobs", enforcedAt: "POST /api/admin/jobs/[id]/cancel" },
  { key: "jobs.client_delay_notice", area: "jobs", label: "Send client delay notices", tier: "manage", canText: "Tell clients a job is running late", cannotText: "Send client delay notices", enforcedAt: "lib/notifications/office-send-permission.ts (client_delay_notice)" },
  { key: "jobs.clock_pause", area: "jobs", label: "Pause a cleaner's clock", tier: "manage", canText: "Pause a cleaner's clock", cannotText: "Pause a cleaner's clock", enforcedAt: "lib/notifications/office-send-permission.ts (clock_pause)" },
  { key: "jobs.delete", area: "jobs", label: "Delete jobs", tier: "full", sensitiveAction: "jobs.delete", canText: "Delete jobs (asked for a PIN)", cannotText: "Delete jobs", enforcedAt: "lib/security/admin-verification.ts (jobs.delete)" },
  { key: "jobs.reset", area: "jobs", label: "Reset jobs and remove work records", tier: "full", sensitiveAction: "jobs.reset", canText: "Reset jobs (asked for a PIN)", cannotText: "Reset jobs", enforcedAt: "lib/security/admin-verification.ts (jobs.reset)" },
  // Laundry
  { key: "laundry.supplier_chase", area: "laundry", label: "Chase laundry suppliers", tier: "manage", canText: "Chase laundry suppliers from the app", cannotText: "Chase laundry suppliers from the app", enforcedAt: "lib/notifications/office-send-permission.ts (supplier_chase)" },
  { key: "laundry.delete", area: "laundry", label: "Delete or override completed laundry", tier: "full", sensitiveAction: "laundry.delete", canText: "Delete or override completed laundry (asked for a PIN)", cannotText: "Delete or override completed laundry", enforcedAt: "lib/security/admin-verification.ts (laundry.delete)" },
  // Lost and found
  { key: "lostfound.guest_message", area: "lost-found", label: "Message guests", tier: "manage", canText: "Message guests about lost property", cannotText: "Message guests from the app", enforcedAt: "lib/notifications/office-send-permission.ts (guest_message)", note: "By inbox, email or SMS, as the item allows." },
  { key: "lostfound.client_notice", area: "lost-found", label: "Tell the client about a found item", tier: "manage", canText: "Tell clients about found items", cannotText: "Tell clients about found items from the app", enforcedAt: "lib/notifications/office-send-permission.ts (lost_item_client_notice)" },
  // Cases
  { key: "cases.delete", area: "cases", label: "Delete cases", tier: "full", sensitiveAction: "cases.delete", canText: "Delete cases (asked for a PIN)", cannotText: "Delete cases", enforcedAt: "lib/security/admin-verification.ts (cases.delete)" },
  // Inventory
  { key: "inventory.urgent_stock_act", area: "inventory", label: "Act on urgent stock", tier: "manage", canText: "Act on urgent stock: stages, shopping runs, asking a cleaner to buy", cannotText: "Act on urgent stock", enforcedAt: "lib/inventory/urgent-stock-access.ts (urgentOfficeAllowed, manage)" },
  // Forms
  { key: "forms.delete", area: "forms", label: "Delete form templates", tier: "full", sensitiveAction: "forms.delete", canText: "Delete form templates (asked for a PIN)", cannotText: "Delete form templates", enforcedAt: "lib/security/admin-verification.ts (forms.delete)" },
  // Properties and clients
  { key: "properties.archive", area: "properties", label: "Archive properties", tier: "full", sensitiveAction: "properties.archive", canText: "Archive properties (asked for a PIN)", cannotText: "Archive properties", enforcedAt: "lib/security/admin-verification.ts (properties.archive)" },
  { key: "clients.delete", area: "clients", label: "Delete clients", tier: "full", sensitiveAction: "clients.delete", canText: "Delete clients (asked for a PIN)", cannotText: "Delete clients", enforcedAt: "lib/security/admin-verification.ts (clients.delete)" },
  // Staff accounts
  { key: "accounts.account_email", area: "accounts", label: "Send account emails", tier: "manage", canText: "Send account emails (invitation, reset link, sign-up code)", cannotText: "Send account emails", enforcedAt: "lib/notifications/office-send-permission.ts (account_email)" },
  // Finance and invoicing
  { key: "invoices.view", area: "finance", label: "See client invoices and totals", tier: "view", canText: "See client invoices and totals", cannotText: "See client invoices", enforcedAt: "Route guard: finance at View (ops-catalog.ts)" },
  { key: "invoices.approve", area: "finance", label: "Approve drafts", tier: "manage", canText: "Approve draft invoices", cannotText: "Approve draft invoices", enforcedAt: "PATCH /api/admin/invoices/[id] (status APPROVED); POST /api/admin/invoices/bulk (approve)" },
  { key: "invoices.send", area: "finance", label: "Send invoices to clients", tier: "manage", canText: "Send invoices to clients", cannotText: "Send invoices to clients", enforcedAt: "POST /api/admin/invoices/[id]/send; POST /api/admin/invoices/bulk (send)" },
  { key: "invoices.record_payment", area: "finance", label: "Record payments and mark paid", tier: "manage", canText: "Record payments and mark invoices paid", cannotText: "Record payments or mark invoices paid", enforcedAt: "PATCH /api/admin/invoices/[id] (recordPayment, status PAID or PART_PAID)" },
  { key: "invoices.void_credit", area: "finance", label: "Void and credit notes", tier: "manage", canText: "Void invoices and raise credit notes", cannotText: "Void invoices or raise credit notes", enforcedAt: "PATCH /api/admin/invoices/[id] (status VOID); POST /api/admin/invoices/[id]/credit-note" },
  { key: "invoices.correct", area: "finance", label: "Reconcile Xero corrections", tier: "full", sensitiveAction: "invoices.correct", canText: "Reconcile Xero invoice corrections (asked for a PIN)", cannotText: "Reconcile Xero corrections", enforcedAt: "lib/security/admin-verification.ts (invoices.correct)" },
  // Messages and notifications
  { key: "messages.read", area: "communications", label: "Read conversations and the delivery log", tier: "view", canText: "Read conversations and the delivery log", cannotText: "Read conversations", enforcedAt: "Route guard: communications at View (ops-catalog.ts)" },
  { key: "messages.compose_send", area: "communications", label: "Send from the message composer", tier: "manage", canText: "Send email or SMS from the message composer", cannotText: "Send from the message composer", enforcedAt: "POST /api/admin/messages/send" },
] as const satisfies readonly CapabilityDefinition[];

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];
export const CAPABILITY_KEYS = CAPABILITIES.map((capability) => capability.key) as CapabilityKey[];

export function capabilityDefinition(key: CapabilityKey): CapabilityDefinition {
  const found = CAPABILITIES.find((capability) => capability.key === key);
  if (!found) throw new Error(`Unknown capability ${key}`);
  return found;
}

export function capabilitiesForArea(area: OpsFeature): CapabilityDefinition[] {
  return CAPABILITIES.filter((capability) => capability.area === area);
}

/** The capability that each existing sensitive-action grant is. */
export const SENSITIVE_ACTION_CAPABILITY: Readonly<Record<SensitiveAction, CapabilityKey>> = {
  "jobs.delete": "jobs.delete",
  "jobs.reset": "jobs.reset",
  "properties.archive": "properties.archive",
  "clients.delete": "clients.delete",
  "cases.delete": "cases.delete",
  "forms.delete": "forms.delete",
  "laundry.delete": "laundry.delete",
  "invoices.correct": "invoices.correct",
};

/**
 * Never part of an operations manager's access at any level. Shown in the
 * "Administrators only" box; to give them, change the person's role.
 */
export const ADMIN_ONLY_ACTIONS: readonly string[] = [
  "Sign-in security: passwords, two-step and sessions",
  "Test as",
  "Roles and permissions (this screen)",
  "Settings audit and restore",
  "Integration credentials",
  "Insights email recipients",
];
