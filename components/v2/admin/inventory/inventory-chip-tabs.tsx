"use client";

/**
 * ESTATE inventory hub tab bar — EChipTabs driving the ?tab= query while keeping
 * links inside /v2 so the Estate shell is preserved.
 */
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Boxes, Building2, ClipboardCheck, ClipboardList, Package, PackageCheck, Truck } from "lucide-react";
import { EChipTabs } from "@/components/v2/admin/estate-kit";

export type InventoryTab =
  | "items"
  | "properties"
  | "on-hand"
  | "stock-counts"
  | "scan-tasks"
  | "shopping-runs"
  | "suppliers"
  | "urgent-stock";

const TABS: Array<{ key: InventoryTab; label: string; icon: React.ReactNode }> = [
  { key: "items", label: "Items", icon: <Package className="h-4 w-4" /> },
  { key: "properties", label: "By Property", icon: <Building2 className="h-4 w-4" /> },
  { key: "on-hand", label: "On-hand", icon: <PackageCheck className="h-4 w-4" /> },
  { key: "stock-counts", label: "Stock Counts", icon: <ClipboardList className="h-4 w-4" /> },
  { key: "scan-tasks", label: "Scan Tasks", icon: <ClipboardCheck className="h-4 w-4" /> },
  { key: "shopping-runs", label: "Shopping Runs", icon: <Boxes className="h-4 w-4" /> },
  { key: "suppliers", label: "Suppliers", icon: <Truck className="h-4 w-4" /> },
];

/**
 * Offered only where the server also grants urgent-stock administration, and
 * then first ("Urgent needs" with the open count, as drawn).
 */
const URGENT_STOCK_TAB = {
  key: "urgent-stock" as const,
  label: "Urgent needs",
  icon: <AlertTriangle className="h-4 w-4" />,
};

/** Query keys owned by the Urgent needs tab's own list view. */
const URGENT_VIEW_KEYS = ["stage", "q", "propertyId", "sort", "dir", "page", "open"];

export function InventoryChipTabs({
  active,
  showUrgentStock = false,
  urgentCount = null,
}: {
  active: InventoryTab;
  showUrgentStock?: boolean;
  /** Open urgent needs (a real count), or null when unknown. */
  urgentCount?: number | null;
}) {
  const urgentTab = { ...URGENT_STOCK_TAB, label: typeof urgentCount === "number" ? `${URGENT_STOCK_TAB.label} ${urgentCount}` : URGENT_STOCK_TAB.label };
  const tabs = showUrgentStock ? [urgentTab, ...TABS] : TABS;
  const searchParams = useSearchParams();
  function hrefFor(key: InventoryTab) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", key);
    // A stale ?filter belongs only to the properties tab.
    if (key !== "properties") params.delete("filter");
    // The urgent list's filters and open need belong only to its tab.
    if (key !== "urgent-stock") URGENT_VIEW_KEYS.forEach((name) => params.delete(name));
    return `/v2/admin/inventory?${params.toString()}`;
  }
  return (
    <EChipTabs
      tabs={tabs.map((t) => ({
        key: t.key,
        label: t.label,
        href: hrefFor(t.key),
        active: t.key === active,
        icon: t.icon,
      }))}
    />
  );
}
