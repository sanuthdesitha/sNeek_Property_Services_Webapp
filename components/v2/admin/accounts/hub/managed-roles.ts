/**
 * Roles an admin can give an account from the Accounts hub. VA is absent on
 * purpose: an assistant login means nothing without its VA team, so it is
 * created and managed from the Assistants tab (the team manager).
 */
import type { AccountTab } from "@/lib/accounts/list/tabs";

export const MANAGED_ROLES = ["ADMIN", "OPS_MANAGER", "QA_INSPECTOR", "CLEANER", "CLIENT", "LAUNDRY", "MAINTENANCE"] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

export function isManagedRole(role: string): role is ManagedRole {
  return (MANAGED_ROLES as readonly string[]).includes(role);
}

/** The role a new account starts with on each tab (as the old category tabs did). */
export const CREATE_ROLE_FOR_TAB: Record<AccountTab, ManagedRole> = {
  everyone: "CLEANER",
  cleaners: "CLEANER",
  office: "OPS_MANAGER",
  clients: "CLIENT",
  assistants: "CLEANER",
  partners: "LAUNDRY",
  attention: "CLEANER",
};
