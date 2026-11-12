/**
 * Accounts hub tabs: one tab per account type, plus Everyone and Needs
 * attention. Pure, shared by the page, the list API and the tests.
 *
 * The old hub used `?tab=team|cleaners|clients|assistants|partners` (and before
 * that `staff` / `vas`). Those links are still in bookmarks and other screens,
 * so every old value maps onto a new tab instead of falling through.
 */
import type { Role } from "@prisma/client";

export const ACCOUNT_TABS = ["everyone", "cleaners", "office", "clients", "assistants", "partners", "attention"] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

export const ACCOUNT_TAB_LABEL: Record<AccountTab, string> = {
  everyone: "Everyone",
  cleaners: "Cleaners",
  office: "Office and other staff",
  clients: "Client logins",
  assistants: "Assistants",
  partners: "Laundry partners",
  attention: "Needs attention",
};

/** The primary roles each role tab covers. `null` = every role. */
export const ACCOUNT_TAB_ROLES: Record<AccountTab, readonly Role[] | null> = {
  everyone: null,
  cleaners: ["CLEANER"],
  // People board (2026-11-12): "Office and other staff" includes Maintenance;
  // "Laundry partners and suppliers" holds the LAUNDRY logins.
  office: ["ADMIN", "OPS_MANAGER", "QA_INSPECTOR", "MAINTENANCE"],
  clients: ["CLIENT"],
  assistants: ["VA"],
  partners: ["LAUNDRY"],
  attention: null,
};

/** Old `?tab=` values and where they land now. */
export const LEGACY_ACCOUNT_TABS: Readonly<Record<string, AccountTab>> = {
  team: "office",
  staff: "office",
  vas: "assistants",
  cleaners: "cleaners",
  clients: "clients",
  assistants: "assistants",
  partners: "partners",
  // People › Everyone › Client logins (the People route's name for this list).
  logins: "clients",
};

export const DEFAULT_ACCOUNT_TAB: AccountTab = "everyone";

export function normalizeAccountTab(value: string | null | undefined): AccountTab {
  const raw = (value ?? "").trim();
  if ((ACCOUNT_TABS as readonly string[]).includes(raw)) return raw as AccountTab;
  return LEGACY_ACCOUNT_TABS[raw] ?? DEFAULT_ACCOUNT_TAB;
}

/** Roles a person filter can offer on a tab that spans more than one. */
export function roleFilterOptions(tab: AccountTab): readonly Role[] {
  const roles = ACCOUNT_TAB_ROLES[tab];
  if (roles && roles.length > 1) return roles;
  if (roles === null) return ["ADMIN", "OPS_MANAGER", "QA_INSPECTOR", "CLEANER", "CLIENT", "VA", "LAUNDRY", "MAINTENANCE"];
  return [];
}

export function tabIncludesRole(tab: AccountTab, role: Role): boolean {
  const roles = ACCOUNT_TAB_ROLES[tab];
  return roles === null || roles.includes(role);
}
