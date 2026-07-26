import type { Role } from "@prisma/client";

// Pure profile-completeness logic — no DB access, safe to import anywhere.
// Defines which profile fields are compulsory per role, computes what's missing,
// and where the user should go to fix it.

export interface ProfileFieldCheck {
  key: string;
  label: string;
}

export interface ProfileCompletenessResult {
  complete: boolean;
  missing: ProfileFieldCheck[];
  fixUrl: string;
}

export type ProfileUserLike = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  abn?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
};

// Everyone must have these.
const BASE_FIELDS: ProfileFieldCheck[] = [
  { key: "name", label: "Full name" },
  { key: "phone", label: "Mobile number" },
  { key: "email", label: "Email address" },
];

// Payees who raise their own invoices against us (cleaners and QA inspectors)
// are contractors, so they also need the details that appear on those invoices.
// (All of them are contractors, so ABN is required.)
const INVOICE_PAYEE_EXTRA_FIELDS: ProfileFieldCheck[] = [
  { key: "address", label: "Residential address" },
  { key: "abn", label: "ABN" },
  { key: "bankAccountName", label: "Bank account name" },
  { key: "bankBsb", label: "Bank BSB" },
  { key: "bankAccountNumber", label: "Bank account number" },
];

export function profileFixUrl(role: Role): string {
  switch (role) {
    case "CLEANER":
      // Cleaners fill every required field on their normal settings page.
      return "/cleaner/settings";
    case "QA_INSPECTOR":
      // Inspectors self-invoice, so their fix-it page must be one that actually
      // captures ABN + bank details. The legacy /qa/profile screen never did;
      // the Estate profile (which the QA portal now mounts with banking on)
      // does. Sending them anywhere else is a dead end.
      return "/v2/qa/profile";
    case "LAUNDRY":
      return "/laundry/profile";
    case "CLIENT":
      return "/client/profile";
    default:
      return "/admin/profile"; // ADMIN, OPS_MANAGER
  }
}

/**
 * Roles that raise their own invoices against the business. QA inspectors were
 * added when inspection pay moved onto the cleaner invoice rail — an inspector
 * self-invoices exactly like a cleaner, so they need the same payee details.
 * Kept here (a pure, DB-free module) so routes, UI and tests share one list.
 */
export const INVOICE_PAYEE_ROLES: Role[] = ["CLEANER", "QA_INSPECTOR"];

export function isInvoicePayeeRole(role: Role | string | null | undefined): boolean {
  return typeof role === "string" && (INVOICE_PAYEE_ROLES as string[]).includes(role);
}

export function requiredProfileFields(role: Role): ProfileFieldCheck[] {
  return isInvoicePayeeRole(role) ? [...BASE_FIELDS, ...INVOICE_PAYEE_EXTRA_FIELDS] : BASE_FIELDS;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export function computeProfileCompleteness(user: ProfileUserLike, role: Role): ProfileCompletenessResult {
  const missing = requiredProfileFields(role).filter((field) => isBlank((user as any)[field.key]));
  return { complete: missing.length === 0, missing, fixUrl: profileFixUrl(role) };
}

// The subset an invoice payee (cleaner or QA inspector) needs before they can
// issue an invoice (their identity + payment details). Used to gate invoice
// send/download and to show a banner.
export function invoicePayeeMissingFields(user: ProfileUserLike): ProfileFieldCheck[] {
  const fields: ProfileFieldCheck[] = [
    { key: "name", label: "Full name" },
    { key: "phone", label: "Mobile number" },
    { key: "email", label: "Email address" },
    ...INVOICE_PAYEE_EXTRA_FIELDS,
  ];
  return fields.filter((field) => isBlank((user as any)[field.key]));
}

/** @deprecated Use invoicePayeeMissingFields — the rail is no longer cleaner-only. */
export const cleanerInvoiceMissingFields = invoicePayeeMissingFields;

/**
 * Where an invoice payee fixes missing details. The v2 Estate portals are the
 * live surfaces; both mount the same EstateProfile banking section.
 */
export function invoicePayeeProfileHref(role: Role | string | null | undefined): string {
  return role === "QA_INSPECTOR" ? "/v2/qa/profile" : "/v2/cleaner/profile";
}

/**
 * Can this user raise their own invoice? Two independent conditions, both
 * required: the role must be on the invoice rail, and every payee detail the
 * invoice prints must be present. Returning the missing list (labels only,
 * never values) lets the caller tell them exactly what to fix and where.
 */
export function canRaiseInvoice(
  user: ProfileUserLike & { role?: Role | string | null }
): { allowed: boolean; roleAllowed: boolean; missing: ProfileFieldCheck[]; fixUrl: string } {
  const roleAllowed = isInvoicePayeeRole(user.role);
  const missing = roleAllowed ? invoicePayeeMissingFields(user) : [];
  return {
    allowed: roleAllowed && missing.length === 0,
    roleAllowed,
    missing,
    fixUrl: invoicePayeeProfileHref(user.role),
  };
}
