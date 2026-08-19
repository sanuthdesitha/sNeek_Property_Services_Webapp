/**
 * V1 — what a VA team is allowed to do.
 *
 * `VaTeam.permissions` is a Json column because the client toggles these from
 * the portal and the set will grow. Json in the database does NOT mean
 * unvalidated in the application: everything passes through `parseVaPermissions`
 * here, and an unrecognised or malformed blob resolves to "nothing granted"
 * rather than being trusted or throwing. A VA whose permissions row is corrupt
 * should lose access, not gain it.
 *
 * THE MONEY RULE IS NOT A PERMISSION. A VA never approves a quote or an extra,
 * never approves a cost, and never pays an invoice — that decision is the
 * client's alone and is not delegable, so it is deliberately absent from the
 * grantable set. `VA_FORBIDDEN_ACTIONS` records the actions that no toggle can
 * ever switch on, and `assertVaMayAct` enforces it independently of whatever
 * the Json says. If money actions were merely "a permission we don't tick",
 * one bad UI checkbox or one hand-edited row would be enough.
 *
 * Invoice VISIBILITY is different from invoice payment and is grantable: a
 * client may well want their assistant reconciling invoices they cannot pay.
 */

import { z } from "zod";

/** Every capability a client can grant a VA team. */
export const VA_PERMISSION_KEYS = [
  /** Create, reschedule and cancel cleans. */
  "bookings",
  /** Raise maintenance and assign it to a worker (CP-8). */
  "maintenance",
  /** View and download cleaning / QA reports. */
  "reports",
  /** View released damage reports. */
  "damage",
  /** SEE invoices. Never pay them — see VA_FORBIDDEN_ACTIONS. */
  "invoicesView",
  /** Read and post on job message threads. */
  "messages",
  /** View and edit the property ops profile (V3). */
  "properties",
] as const;

export type VaPermissionKey = (typeof VA_PERMISSION_KEYS)[number];

/**
 * Actions no VA may perform, whatever the client has toggled.
 *
 * Enforced by assertVaMayAct at the chokepoint rather than by the absence of a
 * permission key, so a malformed permissions blob or a future UI mistake cannot
 * quietly grant one.
 */
export const VA_FORBIDDEN_ACTIONS = [
  "quote_approval",
  "extra_approval",
  "cost_approval",
  "invoice_payment",
] as const;

export type VaForbiddenAction = (typeof VA_FORBIDDEN_ACTIONS)[number];

export type VaPermissions = Record<VaPermissionKey, boolean>;

/** Nothing granted. The result for a missing, malformed or unknown blob. */
export function emptyVaPermissions(): VaPermissions {
  return VA_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as VaPermissions);
}

/**
 * Coerce a stored permissions blob into a complete, boolean-valued record.
 * Never throws: a VA with an unreadable grant is a VA with no access.
 */
export function parseVaPermissions(raw: unknown): VaPermissions {
  const out = emptyVaPermissions();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const row = raw as Record<string, unknown>;
  for (const key of VA_PERMISSION_KEYS) {
    // Strictly boolean true. A truthy string like "false" must not grant
    // access, which is exactly what a loose coercion would do.
    out[key] = row[key] === true;
  }
  return out;
}

/** The zod schema the team-management API validates writes against (V2). */
export const vaPermissionsInputSchema = z.object(
  VA_PERMISSION_KEYS.reduce(
    (shape, key) => {
      shape[key] = z.boolean().default(false);
      return shape;
    },
    {} as Record<VaPermissionKey, z.ZodDefault<z.ZodBoolean>>
  )
);

export function hasVaPermission(permissions: VaPermissions, key: VaPermissionKey): boolean {
  return permissions[key] === true;
}

/**
 * Throw if an action is one a VA may never perform.
 *
 * Call this on the action, not on a permission: the point is that no grant can
 * satisfy it. A CLIENT actor passes straight through — the restriction is about
 * delegation, not about the capability itself.
 */
export function assertVaMayAct(actor: "CLIENT" | "VA", action: string): void {
  if (actor !== "VA") return;
  if ((VA_FORBIDDEN_ACTIONS as readonly string[]).includes(action)) {
    throw new Error("VA_ACTION_FORBIDDEN");
  }
}

/**
 * Resolve a team's property scope.
 *
 * An absent or empty list means EVERY property of the client — that is the
 * client's own default when they add a team and have not narrowed it. A list
 * with entries restricts to exactly those ids.
 *
 * Returned as null (meaning "no restriction") rather than a list of all the
 * client's property ids, so callers can express the difference in a query
 * instead of loading the client's whole portfolio to build an IN clause.
 */
export function parseVaPropertyScope(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  return ids.length > 0 ? ids : null;
}

/**
 * Plain-language labels for the grantable set.
 *
 * Shared rather than copied because the admin invite screen and the client
 * management screen describe the SAME grants; two copies would drift the
 * moment a key is added, and a permission described differently in the two
 * places is a permission the client does not actually understand.
 * The keys are the contract — these strings are not.
 */
export const VA_PERMISSION_LABELS: Record<VaPermissionKey, { title: string; hint: string }> = {
  bookings: { title: "Bookings", hint: "Book, reschedule and cancel cleans" },
  maintenance: { title: "Maintenance", hint: "Raise jobs and assign a worker" },
  reports: { title: "Reports", hint: "View and download cleaning reports" },
  damage: { title: "Damage", hint: "View released damage reports" },
  invoicesView: { title: "See invoices", hint: "View only — never pay them" },
  messages: { title: "Messages", hint: "Read and post on job threads" },
  properties: { title: "Properties", hint: "View and edit property profiles" },
};
