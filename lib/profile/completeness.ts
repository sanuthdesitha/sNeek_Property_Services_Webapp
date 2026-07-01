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

// Cleaners are contractors who invoice us, so they also need the details that
// appear on their invoices. (All cleaners are contractors, so ABN is required.)
const CLEANER_EXTRA_FIELDS: ProfileFieldCheck[] = [
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
      return "/qa/profile";
    case "LAUNDRY":
      return "/laundry/profile";
    case "CLIENT":
      return "/client/profile";
    default:
      return "/admin/profile"; // ADMIN, OPS_MANAGER
  }
}

export function requiredProfileFields(role: Role): ProfileFieldCheck[] {
  return role === "CLEANER" ? [...BASE_FIELDS, ...CLEANER_EXTRA_FIELDS] : BASE_FIELDS;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export function computeProfileCompleteness(user: ProfileUserLike, role: Role): ProfileCompletenessResult {
  const missing = requiredProfileFields(role).filter((field) => isBlank((user as any)[field.key]));
  return { complete: missing.length === 0, missing, fixUrl: profileFixUrl(role) };
}

// The subset a cleaner needs before they can issue an invoice (their identity +
// payment details). Used to gate invoice send/download and to show a banner.
export function cleanerInvoiceMissingFields(user: ProfileUserLike): ProfileFieldCheck[] {
  const fields: ProfileFieldCheck[] = [
    { key: "name", label: "Full name" },
    { key: "phone", label: "Mobile number" },
    { key: "email", label: "Email address" },
    ...CLEANER_EXTRA_FIELDS,
  ];
  return fields.filter((field) => isBlank((user as any)[field.key]));
}
