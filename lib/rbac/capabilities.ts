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
 *             person's own PIN at the moment of use.
 * - "grant":  an administrator capability (owner decision 2026-11-12): off
 *             for every non-administrator until an ADMIN grants it to that
 *             person (never through a preset). Sensitive, PIN-protected, and
 *             bounded by the guardrails in `lib/rbac/delegated-admin.ts`: never
 *             on an administrator or anyone with more access, never on
 *             oneself, never while testing as someone.
 *
 * `enforcedAt` names the server enforcement point that calls the shared
 * evaluator (`lib/rbac/can.ts`). The area of each capability is the area the
 * enforcement point's route already belongs to in `ops-catalog.ts`, so a
 * capability can only narrow what the route guard already allows.
 */
import type { SensitiveAction } from "@/lib/security/sensitive-actions";
import type { OpsFeature } from "./ops-catalog";

export type CapabilityTier = "view" | "manage" | "full" | "grant";

export type CapabilityDefinition = {
  key: string;
  /** The ops area it belongs to; null for administrator capabilities. */
  area: OpsFeature | null;
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
  { key: "jobs.team_message", area: "jobs", label: "Message a job's team", tier: "manage", canText: "Message the cleaners assigned to a job", cannotText: "Message a job's team", enforcedAt: "lib/notifications/office-send-permission.ts (job_team_message)" },
  { key: "jobs.clock_pause", area: "jobs", label: "Pause a cleaner's clock", tier: "manage", canText: "Pause a cleaner's clock", cannotText: "Pause a cleaner's clock", enforcedAt: "lib/notifications/office-send-permission.ts (clock_pause)" },
  { key: "jobs.delete", area: "jobs", label: "Delete jobs", tier: "full", sensitiveAction: "jobs.delete", canText: "Delete jobs (asked for their own PIN)", cannotText: "Delete jobs", enforcedAt: "lib/security/admin-verification.ts (jobs.delete)" },
  { key: "jobs.reset", area: "jobs", label: "Reset jobs and remove work records", tier: "full", sensitiveAction: "jobs.reset", canText: "Reset jobs (asked for their own PIN)", cannotText: "Reset jobs", enforcedAt: "lib/security/admin-verification.ts (jobs.reset)" },
  // Laundry
  { key: "laundry.supplier_chase", area: "laundry", label: "Chase laundry suppliers", tier: "manage", canText: "Chase laundry suppliers from the app", cannotText: "Chase laundry suppliers from the app", enforcedAt: "lib/notifications/office-send-permission.ts (supplier_chase)" },
  { key: "laundry.delete", area: "laundry", label: "Delete or override completed laundry", tier: "full", sensitiveAction: "laundry.delete", canText: "Delete or override completed laundry (asked for their own PIN)", cannotText: "Delete or override completed laundry", enforcedAt: "lib/security/admin-verification.ts (laundry.delete)" },
  // Lost and found
  { key: "lostfound.guest_message", area: "lost-found", label: "Message guests", tier: "manage", canText: "Message guests about lost property", cannotText: "Message guests from the app", enforcedAt: "lib/notifications/office-send-permission.ts (guest_message)", note: "By inbox, email or SMS, as the item allows." },
  { key: "lostfound.client_notice", area: "lost-found", label: "Tell the client about a found item", tier: "manage", canText: "Tell clients about found items", cannotText: "Tell clients about found items from the app", enforcedAt: "lib/notifications/office-send-permission.ts (lost_item_client_notice)" },
  // Cases
  { key: "cases.delete", area: "cases", label: "Delete cases", tier: "full", sensitiveAction: "cases.delete", canText: "Delete cases (asked for their own PIN)", cannotText: "Delete cases", enforcedAt: "lib/security/admin-verification.ts (cases.delete)" },
  // Inventory
  { key: "inventory.urgent_stock_act", area: "inventory", label: "Act on urgent stock", tier: "manage", canText: "Act on urgent stock: stages, shopping runs, asking a cleaner to buy", cannotText: "Act on urgent stock", enforcedAt: "lib/inventory/urgent-stock-access.ts (urgentOfficeAllowed, manage)" },
  // Forms
  { key: "forms.delete", area: "forms", label: "Delete form templates", tier: "full", sensitiveAction: "forms.delete", canText: "Delete form templates (asked for their own PIN)", cannotText: "Delete form templates", enforcedAt: "lib/security/admin-verification.ts (forms.delete)" },
  // Properties and clients
  { key: "properties.archive", area: "properties", label: "Archive properties", tier: "full", sensitiveAction: "properties.archive", canText: "Archive properties (asked for their own PIN)", cannotText: "Archive properties", enforcedAt: "lib/security/admin-verification.ts (properties.archive)" },
  { key: "clients.delete", area: "clients", label: "Delete clients", tier: "full", sensitiveAction: "clients.delete", canText: "Delete clients (asked for their own PIN)", cannotText: "Delete clients", enforcedAt: "lib/security/admin-verification.ts (clients.delete)" },
  // Staff accounts
  { key: "accounts.account_email", area: "accounts", label: "Send account emails", tier: "manage", canText: "Send account emails (invitation, reset link, sign-up code)", cannotText: "Send account emails", enforcedAt: "lib/notifications/office-send-permission.ts (account_email)" },
  // Finance and invoicing
  { key: "invoices.view", area: "finance", label: "See client invoices and totals", tier: "view", canText: "See client invoices and totals", cannotText: "See client invoices", enforcedAt: "Route guard: finance at View (ops-catalog.ts)" },
  { key: "invoices.approve", area: "finance", label: "Approve drafts", tier: "manage", canText: "Approve draft invoices", cannotText: "Approve draft invoices", enforcedAt: "PATCH /api/admin/invoices/[id] (status APPROVED); POST /api/admin/invoices/bulk (approve)" },
  { key: "invoices.send", area: "finance", label: "Send invoices to clients", tier: "manage", canText: "Send invoices to clients", cannotText: "Send invoices to clients", enforcedAt: "POST /api/admin/invoices/[id]/send; POST /api/admin/invoices/bulk (send)" },
  { key: "invoices.record_payment", area: "finance", label: "Record payments and mark paid", tier: "manage", canText: "Record payments and mark invoices paid", cannotText: "Record payments or mark invoices paid", enforcedAt: "PATCH /api/admin/invoices/[id] (recordPayment, status PAID or PART_PAID)" },
  // Owner decision 2026-11-13: void and credit notes is a sensitive action
  // (was "manage"). Needs Finance at Full or the explicit grant, and the
  // acting person's own PIN on every void and credit-note route.
  { key: "invoices.void_credit", area: "finance", label: "Void and credit notes", tier: "full", sensitiveAction: "invoices.void_credit", canText: "Void invoices and raise credit notes (asked for their own PIN)", cannotText: "Void invoices or raise credit notes", enforcedAt: "PATCH /api/admin/invoices/[id] (status VOID); POST /api/admin/invoices/[id]/credit-note; lib/security/admin-verification.ts (invoices.void_credit)" },
  { key: "invoices.correct", area: "finance", label: "Reconcile Xero corrections", tier: "full", sensitiveAction: "invoices.correct", canText: "Reconcile Xero invoice corrections (asked for their own PIN)", cannotText: "Reconcile Xero corrections", enforcedAt: "lib/security/admin-verification.ts (invoices.correct)" },
  // Messages and notifications
  { key: "messages.read", area: "communications", label: "Read conversations and the delivery log", tier: "view", canText: "Read conversations and the delivery log", cannotText: "Read conversations", enforcedAt: "Route guard: communications at View (ops-catalog.ts)" },
  { key: "messages.compose_send", area: "communications", label: "Send from the message composer", tier: "manage", canText: "Send email or SMS from the message composer", cannotText: "Send from the message composer", enforcedAt: "POST /api/admin/messages/send" },
  // Administrator capabilities (tier "grant"): individually granted by an ADMIN.
  { key: "accounts.reset_password", area: null, label: "Reset another person's password", tier: "grant", canText: "Reset the password of someone with no more access than them (asked for their own PIN)", cannotText: "Reset other people's passwords", enforcedAt: "POST /api/admin/users/[id]/reset-password (requireDelegatedAction)" },
  { key: "accounts.reset_two_step", area: null, label: "Reset two-step verification", tier: "grant", canText: "Reset two-step verification for someone with no more access than them (asked for their own PIN)", cannotText: "Reset two-step verification", enforcedAt: "POST /api/admin/users/[id]/disable-2fa (requireDelegatedAction)" },
  { key: "access.test_as", area: null, label: "Test as another person", tier: "grant", canText: "Test as someone with no more access than them (asked for their own PIN)", cannotText: "Use Test as", enforcedAt: "POST /api/admin/test-as/unlock, POST /api/admin/impersonate, lib/auth/impersonation-server.ts (every request)" },
  { key: "access.edit_permissions", area: null, label: "Edit access and permissions", tier: "grant", canText: "Change the access of people below them, up to their own access (asked for their own PIN)", cannotText: "Change anyone's access", enforcedAt: "GET/PUT /api/admin/ops-permissions (delegatedPolicyRefusal)" },
  // Owner decision 2026-11-14: scheduling rules are ADMIN-only until an ADMIN grants this.
  { key: "scheduling.rules_edit", area: null, label: "Change the scheduling rules", tier: "grant", canText: "Change, restore or import the laundry and job scheduling rules (asked for their own PIN)", cannotText: "Change the scheduling rules", enforcedAt: "/api/admin/settings/scheduling-rules/* (requireDelegatedAction + verifySensitiveAction scheduling.rules_edit)" },
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

/** Administrator capabilities, granted per person by an ADMIN only. */
export const GRANT_CAPABILITY_KEYS = CAPABILITIES.filter((capability) => capability.tier === "grant").map(
  (capability) => capability.key,
) as CapabilityKey[];

export function isGrantCapability(key: CapabilityKey): boolean {
  return GRANT_CAPABILITY_KEYS.includes(key);
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
  "invoices.void_credit": "invoices.void_credit",
  "scheduling.rules_edit": "scheduling.rules_edit",
};

/**
 * What stays with administrators only, with the reason. Shown in the "Only
 * administrators" box (owner decision 2026-11-12 made the rest grantable).
 */
export const ADMIN_ONLY_ACTIONS: ReadonlyArray<{ label: string; reason: string }> = [
  { label: "Granting or withdrawing administrator capabilities", reason: "Only an administrator may hand these out, so a grant can never spread by itself." },
  { label: "Changing a role to or from Administrator", reason: "Administrators have everything by rule; limiting one means changing their role in Accounts." },
  { label: "Security settings and sessions policy", reason: "They apply to every account, administrators included, so they cannot be bounded by the editor's own access." },
  { label: "Integration credentials", reason: "Secrets for the whole business; reading or replacing them reaches past any area level." },
  { label: "Settings audit and restore", reason: "Restore rewrites settings for everyone, administrators included." },
  { label: "Insights email recipients", reason: "It sends the whole business summary, including figures outside the editor's areas, to the addresses chosen." },
];
