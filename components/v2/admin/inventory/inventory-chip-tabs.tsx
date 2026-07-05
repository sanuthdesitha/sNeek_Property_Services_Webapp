"use client";

/**
 * ESTATE inventory hub tab bar — EChipTabs driving the ?tab= query while keeping
 * links inside /v2 so the Estate shell is preserved.
 */
import { useSearchParams } from "next/navigation";
import { Boxes, Building2, ClipboardList, Package, PackageCheck, Truck } from "lucide-react";
import { EChipTabs } from "@/components/v2/admin/estate-kit";

export type InventoryTab = "items" | "properties" | "on-hand" | "stock-counts" | "shopping-runs" | "suppliers";

const TABS: Array<{ key: InventoryTab; label: string; icon: React.ReactNode }> = [
  { key: "items", label: "Items", icon: <Package className="h-4 w-4" /> },
  { key: "properties", label: "By Property", icon: <Building2 className="h-4 w-4" /> },
  { key: "on-hand", label: "On-hand", icon: <PackageCheck className="h-4 w-4" /> },
  { key: "stock-counts", label: "Stock Counts", icon: <ClipboardList className="h-4 w-4" /> },
  { key: "shopping-runs", label: "Shopping Runs", icon: <Boxes className="h-4 w-4" /> },
  { key: "suppliers", label: "Suppliers", icon: <Truck className="h-4 w-4" /> },
];

export function InventoryChipTabs({ active }: { active: InventoryTab }) {
  const searchParams = useSearchParams();
  function hrefFor(key: InventoryTab) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    // A stale ?filter belongs only to the properties tab.
    if (key !== "properties") params.delete("filter");
    return `/v2/admin/inventory?${params.toString()}`;
  }
  return (
    <EChipTabs
      tabs={TABS.map((t) => ({
        key: t.key,
        label: t.label,
        href: hrefFor(t.key),
        active: t.key === active,
        icon: t.icon,
      }))}
    />
  );
}
