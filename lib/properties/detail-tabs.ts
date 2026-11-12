/**
 * Property page tabs as drawn, and the old `?tab=` ids they replace. Plain
 * module: the server page reads it to open the requested tab.
 *
 *   profile   → overview   (the old "Profile & edit" form is now Overview's cards)
 *   inventory → stock
 *   jobs, checklist, access, billing keep their ids.
 */
export const PROPERTY_TABS = ["overview", "checklist", "access", "stock", "jobs", "care", "billing"] as const;
export type PropertyTab = (typeof PROPERTY_TABS)[number];

export const PROPERTY_TAB_LABEL: Record<PropertyTab, string> = {
  overview: "Overview",
  checklist: "Checklist and forms",
  access: "Access guide",
  stock: "Stock",
  jobs: "Jobs and history",
  care: "Care and planning",
  billing: "Billing rates",
};

const LEGACY_TABS: Record<string, PropertyTab> = {
  profile: "overview",
  inventory: "stock",
};

/** The tab a `?tab=` value opens; unknown or missing values open Overview. */
export function resolvePropertyTab(value: string | null | undefined): PropertyTab {
  if (!value) return "overview";
  if ((PROPERTY_TABS as readonly string[]).includes(value)) return value as PropertyTab;
  return LEGACY_TABS[value] ?? "overview";
}
