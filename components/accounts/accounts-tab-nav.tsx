"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccountsTabKey = "staff" | "clients";

const TABS: Array<{ key: AccountsTabKey; label: string; icon: React.ReactNode }> = [
  { key: "staff", label: "Staff", icon: <Users className="h-4 w-4" /> },
  { key: "clients", label: "Clients", icon: <Building2 className="h-4 w-4" /> },
];

/**
 * Horizontal, scroll-on-mobile tab bar for the Accounts hub. The active tab is
 * driven by the `?tab=` query param so the server component can render the
 * matching section; links preserve any other query params.
 */
export function AccountsTabNav({ active }: { active: AccountsTabKey }) {
  const searchParams = useSearchParams();

  function hrefFor(key: AccountsTabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    return `/admin/accounts?${params.toString()}`;
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex min-w-full items-center gap-1 rounded-xl border border-border bg-surface-raised p-1">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={hrefFor(tab.key)}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none sm:justify-start",
                isActive
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
