"use client";

import { useSearchParams } from "next/navigation";
import { ShieldCheck, Sparkles, Building2, UserCog, Truck } from "lucide-react";
import { EChipTabs } from "@/components/v2/admin/estate-kit";

/**
 * Estate (v2) Accounts hub — one tab per ACCOUNT TYPE.
 *
 * The old split was "staff" and "clients", which mixed two different questions:
 * the staff tab was really every login filtered by a dropdown, and the clients
 * tab duplicated the client list at /v2/admin/clients. Categorising by account
 * type answers the question an admin actually arrives with — "find this
 * person's login" — and leaves /v2/admin/clients to be about the BUSINESS
 * (properties, invoices, jobs) rather than about who can sign in.
 */
export type EstateAccountsTabKey = "team" | "cleaners" | "clients" | "assistants" | "partners";

export const ESTATE_ACCOUNTS_TABS: EstateAccountsTabKey[] = [
  "team",
  "cleaners",
  "clients",
  "assistants",
  "partners",
];

export function EstateAccountsTabNav({ active }: { active: EstateAccountsTabKey }) {
  const searchParams = useSearchParams();

  function hrefFor(key: EstateAccountsTabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    return `/v2/admin/accounts?${params.toString()}`;
  }

  const tabs: Array<{ key: EstateAccountsTabKey; label: string; icon: JSX.Element }> = [
    { key: "team", label: "Team", icon: <ShieldCheck className="h-4 w-4" /> },
    { key: "cleaners", label: "Cleaners", icon: <Sparkles className="h-4 w-4" /> },
    { key: "clients", label: "Client logins", icon: <Building2 className="h-4 w-4" /> },
    { key: "assistants", label: "Assistants", icon: <UserCog className="h-4 w-4" /> },
    { key: "partners", label: "Partners", icon: <Truck className="h-4 w-4" /> },
  ];

  return (
    <EChipTabs
      tabs={tabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        icon: tab.icon,
        href: hrefFor(tab.key),
        active: active === tab.key,
      }))}
    />
  );
}
