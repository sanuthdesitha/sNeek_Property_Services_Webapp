"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type Filter = "all" | "low" | "pending" | "stale";

export function PropertyFilterTabs({
  current,
  totals,
}: {
  current: Filter;
  totals: { properties: number; lowStock: number; pendingShopping: number; stale: number };
}) {
  const searchParams = useSearchParams();
  const tabs: Array<{ value: Filter; label: string; count: number }> = [
    { value: "all", label: "All", count: totals.properties },
    { value: "low", label: "Below reorder", count: totals.lowStock },
    { value: "pending", label: "Pending shopping", count: totals.pendingShopping },
    { value: "stale", label: "No restock >30d", count: totals.stale },
  ];

  function hrefFor(value: Filter) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    const query = params.toString();
    return query ? `?${query}` : "/admin/inventory/properties";
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface-raised p-1">
      {tabs.map((tab) => {
        const isActive = current === tab.value;
        return (
          <Link
            key={tab.value}
            href={hrefFor(tab.value)}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-surface hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold",
                isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {tab.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
