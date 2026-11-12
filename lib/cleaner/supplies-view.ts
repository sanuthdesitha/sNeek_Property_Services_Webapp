/**
 * Supplies tab model for the cleaner portal (approved board, 2026-11):
 * To do · Shopping · Counts · Urgent · My stock.
 *
 * Plain module (server page + tests). Older `?tab=` values keep their meaning:
 * quick-scan, restock and stock-runs open the matching tool inside Counts.
 */
import type { UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";

export type SuppliesTabKey = "todo" | "shopping" | "counts" | "urgent-stock" | "my-stock";
export type CountsToolKey = "stock-runs" | "quick-scan" | "restock";

export interface SuppliesModules {
  shopping: boolean;
  stockRuns: boolean;
}

export interface SuppliesTabDef {
  key: SuppliesTabKey;
  label: string;
}

export function suppliesTabs(modules: SuppliesModules): SuppliesTabDef[] {
  const tabs: SuppliesTabDef[] = [{ key: "todo", label: "To do" }];
  if (modules.shopping) tabs.push({ key: "shopping", label: "Shopping" });
  tabs.push({ key: "counts", label: "Counts" });
  tabs.push({ key: "urgent-stock", label: "Urgent" });
  tabs.push({ key: "my-stock", label: "My stock" });
  return tabs;
}

export function countsTools(modules: SuppliesModules): Array<{ key: CountsToolKey; label: string }> {
  const tools: Array<{ key: CountsToolKey; label: string }> = [];
  if (modules.stockRuns) tools.push({ key: "stock-runs", label: "Stock counts" });
  tools.push({ key: "quick-scan", label: "Quick scan" });
  tools.push({ key: "restock", label: "Restock" });
  return tools;
}

/**
 * Resolve the requested tab (and the Counts tool) from the URL. A disabled
 * module's tab cannot be reached by URL; unknown values fall back to To do.
 */
export function resolveSuppliesTab(
  requestedTab: string | undefined,
  requestedTool: string | undefined,
  modules: SuppliesModules,
): { tab: SuppliesTabKey; tool: CountsToolKey } {
  const tabKey = (requestedTab ?? "").toLowerCase();
  const tools = countsTools(modules);
  const toolFor = (value: string | undefined): CountsToolKey => {
    const wanted = (value ?? "").toLowerCase();
    return tools.find((tool) => tool.key === wanted)?.key ?? tools[0].key;
  };
  if (tabKey === "quick-scan" || tabKey === "restock" || (tabKey === "stock-runs" && modules.stockRuns)) {
    return { tab: "counts", tool: toolFor(tabKey) };
  }
  const available = suppliesTabs(modules).map((tab) => tab.key) as string[];
  const tab = available.includes(tabKey) ? (tabKey as SuppliesTabKey) : "todo";
  return { tab, tool: toolFor(requestedTool) };
}

export const URGENT_STAGE_LABEL: Record<UrgentStockStage, string> = {
  REPORTED: "Reported",
  ACKNOWLEDGED: "Acknowledged",
  ORDERED: "Order recorded",
  DELIVERED: "Delivery recorded",
  PROPERTY_CONFIRMED: "Confirmed at property",
  ADMIN_RESOLVED: "Resolved by administrator",
};

export function urgentStageLabel(stage: string): string {
  return (URGENT_STAGE_LABEL as Record<string, string>)[stage] ?? "Status not recognised";
}
