"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Boxes,
  Building2,
  ClipboardList,
  Package,
  PackageCheck,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InventoryTabKey } from "@/components/inventory/inventory-tab-nav";

const TABS: Array<{ key: InventoryTabKey; label: string; icon: React.ReactNode }> = [
  { key: "items", label: "Items", icon: <Package className="h-4 w-4" /> },
  { key: "properties", label: "By Property", icon: <Building2 className="h-4 w-4" /> },
  { key: "on-hand", label: "On-hand", icon: <PackageCheck className="h-4 w-4" /> },
  { key: "stock-counts", label: "Stock Counts", icon: <ClipboardList className="h-4 w-4" /> },
  { key: "shopping-runs", label: "Shopping Runs", icon: <Boxes className="h-4 w-4" /> },
  { key: "suppliers", label: "Suppliers", icon: <Truck className="h-4 w-4" /> },
];

/**
 * Estate (v2) variant of the Inventory hub tab bar. Identical behaviour to
 * components/inventory/inventory-tab-nav.tsx but links stay inside /v2 so the
 * Estate shell is preserved while switching tabs.
 */
export function EstateInventoryTabNav({ active }: { active: InventoryTabKey }) {
  const searchParams = useSearchParams();

  function hrefFor(key: InventoryTabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    return `/v2/admin/inventory?${params.toString()}`;
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
