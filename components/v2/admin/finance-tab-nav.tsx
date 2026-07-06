"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadgeDollarSign, BarChart3, FileText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type FinanceTabKey = "overview" | "invoices" | "payroll" | "adjustments";

const TABS: Array<{ key: FinanceTabKey; label: string; icon: React.ReactNode }> = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "invoices", label: "Invoices", icon: <FileText className="h-4 w-4" /> },
  { key: "payroll", label: "Payroll", icon: <Wallet className="h-4 w-4" /> },
  { key: "adjustments", label: "Adjustments", icon: <BadgeDollarSign className="h-4 w-4" /> },
];

/**
 * Estate-portal twin of the v1 FinanceTabNav: same `?tab=` keys so the server
 * component renders the matching section, but links stay on /v2/admin/finance.
 */
export function FinanceTabNavV2({ active }: { active: FinanceTabKey }) {
  const searchParams = useSearchParams();

  function hrefFor(key: FinanceTabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    return `/v2/admin/finance?${params.toString()}`;
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
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
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-sm"
                  : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]",
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
