/**
 * Required documents per role (Wave E, 2026-11). Pure rules, safe for the
 * browser: the setting's shape, the document categories, and each required
 * type's state for one person.
 *
 * The default list is EMPTY: with no requirement set, nothing is ever shown as
 * missing (requirements are never invented). A person's requirements are the
 * union of the lists for every role they hold (primary + extra roles).
 *
 * A required type is:
 *  - PRESENT  — a document of that category on file (not rejected) with no
 *               expiry or an expiry more than the warning window away;
 *  - EXPIRING — the best such document expires within the warning window;
 *  - EXPIRED  — documents of that category exist but every one has expired;
 *  - MISSING  — no document of that category on file (rejected ones do not count).
 */
import { z } from "zod";
import type { Role } from "@prisma/client";

/** The same categories the Compliance board and the upload form offer. */
export const STAFF_DOCUMENT_CATEGORIES = ["POLICE_CHECK", "DRIVER_LICENCE", "COMPLIANCE", "TRAINING", "INSURANCE", "WORKING_RIGHTS", "OTHER"] as const;
export type StaffDocumentCategory = (typeof STAFF_DOCUMENT_CATEGORIES)[number];

export const STAFF_DOCUMENT_CATEGORY_LABEL: Record<StaffDocumentCategory, string> = {
  POLICE_CHECK: "Police check",
  DRIVER_LICENCE: "Driver licence",
  COMPLIANCE: "Compliance",
  TRAINING: "Training",
  INSURANCE: "Insurance",
  WORKING_RIGHTS: "Working rights",
  OTHER: "Other",
};

/** Staff roles a requirement can be set for (client-side accounts hold no staff documents). */
export const REQUIREMENT_ROLES = ["CLEANER", "QA_INSPECTOR", "LAUNDRY", "MAINTENANCE", "OPS_MANAGER", "ADMIN"] as const satisfies readonly Role[];
export type RequirementRole = (typeof REQUIREMENT_ROLES)[number];

export const requiredDocumentsSchema = z
  .object({
    byRole: z.record(z.enum(REQUIREMENT_ROLES), z.array(z.enum(STAFF_DOCUMENT_CATEGORIES)).max(STAFF_DOCUMENT_CATEGORIES.length)),
  })
  .strict();
export type RequiredDocumentsSetting = z.infer<typeof requiredDocumentsSchema>;

export const EMPTY_REQUIRED_DOCUMENTS: RequiredDocumentsSetting = { byRole: {} };

/** Days before expiry a required document counts as expiring (the accounts list's window). */
export const REQUIRED_DOCUMENT_WARNING_DAYS = 14;

export type RequiredDocumentState = "PRESENT" | "EXPIRING" | "EXPIRED" | "MISSING";

export type RequiredDocumentStatus = {
  category: StaffDocumentCategory;
  label: string;
  state: RequiredDocumentState;
  /** Expiry of the best document on file (yyyy-MM-dd), when it has one. */
  expiresOn: string | null;
  /** Whole days until that expiry (negative = days since). */
  daysRemaining: number | null;
};

export type RequirementDocument = { category: string; status: string; expiresAt: Date | string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(value: Date | string): string {
  return (typeof value === "string" ? new Date(value) : value).toISOString().slice(0, 10);
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/** The categories required of someone holding these roles, in a stable order. */
export function requiredCategoriesFor(setting: RequiredDocumentsSetting, roles: readonly Role[]): StaffDocumentCategory[] {
  const wanted = new Set<StaffDocumentCategory>();
  for (const role of roles) {
    for (const category of setting.byRole[role as RequirementRole] ?? []) wanted.add(category);
  }
  return STAFF_DOCUMENT_CATEGORIES.filter((category) => wanted.has(category));
}

/**
 * Each required type's state. `todayKey` is the organisation's calendar day
 * (Sydney). Expiry dates are compared as calendar days.
 */
export function requiredDocumentStatuses(
  categories: readonly StaffDocumentCategory[],
  documents: readonly RequirementDocument[],
  todayKey: string,
): RequiredDocumentStatus[] {
  return categories.map((category) => {
    const onFile = documents.filter((doc) => doc.category === category && doc.status !== "REJECTED");
    const base = { category, label: STAFF_DOCUMENT_CATEGORY_LABEL[category] };
    if (onFile.length === 0) return { ...base, state: "MISSING", expiresOn: null, daysRemaining: null };
    if (onFile.some((doc) => !doc.expiresAt)) return { ...base, state: "PRESENT", expiresOn: null, daysRemaining: null };
    const latest = onFile.map((doc) => dayKey(doc.expiresAt as Date | string)).sort().at(-1) as string;
    const days = daysBetween(todayKey, latest);
    const state: RequiredDocumentState = days < 0 ? "EXPIRED" : days <= REQUIRED_DOCUMENT_WARNING_DAYS ? "EXPIRING" : "PRESENT";
    return { ...base, state, expiresOn: latest, daysRemaining: days };
  });
}

/** Labels of required types with nothing on file (what the list counts as missing). */
export function missingRequiredLabels(statuses: readonly RequiredDocumentStatus[]): string[] {
  return statuses.filter((status) => status.state === "MISSING").map((status) => status.label);
}
