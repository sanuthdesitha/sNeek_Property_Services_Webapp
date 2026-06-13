"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PropertyInventoryFilter, PropertyInventoryTotals } from "./property-inventory-overview";

/**
 * Filter tabs for the "By Property" hub tab. Keeps `tab=properties` in the URL
 * and toggles the `filter` query param so the server can re-render the matching
 * subset.
 */
export function PropertyInventoryFilterTabs({
  current,
  totals,
}: {
  current: PropertyInventoryFilter;
  totals: PropertyInventoryTotals;
}) {
  const searchParams = useSearchParams();
  const tabs: Array<{ value: PropertyInventoryFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: totals.properties },
    { value: "low", label: "Below reorder", count: totals.lowStock },
    { value: "pending", label: "Pending shopping", count: totals.pendingShopping },
    { value: "stale", label: "No restock >30d", count: totals.stale },
  ];

  function hrefFor(value: PropertyInventoryFilter) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "properties");
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    return `/admin/inventory?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-raised p-1">
      {tabs.map((tab) => {
        const isActive = current === tab.value;
        return (
          <Link
            key={tab.value}
            href={hrefFor(tab.value)}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
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
