"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart3, FileText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type FinanceTabKey = "overview" | "invoices" | "payroll";

const TABS: Array<{ key: FinanceTabKey; label: string; icon: React.ReactNode }> = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "invoices", label: "Invoices", icon: <FileText className="h-4 w-4" /> },
  { key: "payroll", label: "Payroll", icon: <Wallet className="h-4 w-4" /> },
];

/**
 * Horizontal, scroll-on-mobile tab bar for the Finance hub. The active tab is
 * driven by the `?tab=` query param so the server component can render the
 * matching section; links preserve any other query params.
 */
export function FinanceTabNav({ active }: { active: FinanceTabKey }) {
  const searchParams = useSearchParams();

  function hrefFor(key: FinanceTabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    return `/admin/finance?${params.toString()}`;
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
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
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
