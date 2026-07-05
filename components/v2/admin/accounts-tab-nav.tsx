"use client";

import { useSearchParams } from "next/navigation";
import { Users, Building2 } from "lucide-react";
import { EChipTabs } from "@/components/v2/admin/estate-kit";

export type EstateAccountsTabKey = "staff" | "clients";

export const ESTATE_ACCOUNTS_TABS: EstateAccountsTabKey[] = ["staff", "clients"];

/**
 * Estate (v2) Accounts hub tab bar. Links stay inside /v2 so the Estate shell
 * is preserved while switching tabs.
 */
export function EstateAccountsTabNav({ active }: { active: EstateAccountsTabKey }) {
  const searchParams = useSearchParams();

  function hrefFor(key: EstateAccountsTabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    return `/v2/admin/accounts?${params.toString()}`;
  }

  return (
    <EChipTabs
      tabs={[
        {
          key: "staff",
          label: "Staff",
          icon: <Users className="h-4 w-4" />,
          href: hrefFor("staff"),
          active: active === "staff",
        },
        {
          key: "clients",
          label: "Clients",
          icon: <Building2 className="h-4 w-4" />,
          href: hrefFor("clients"),
          active: active === "clients",
        },
      ]}
    />
  );
}
