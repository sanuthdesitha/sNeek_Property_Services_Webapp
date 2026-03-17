export const INVENTORY_LOCATIONS = [
  "BATHROOM",
  "KITCHEN",
  "CLEANERS_CUPBOARD",
] as const;

export type InventoryLocation = (typeof INVENTORY_LOCATIONS)[number];

export const INVENTORY_LOCATION_LABELS: Record<InventoryLocation, string> = {
  BATHROOM: "Bathroom",
  KITCHEN: "Kitchen",
  CLEANERS_CUPBOARD: "Cleaners Cupboard",
};

export function normalizeInventoryLocation(
  value: unknown,
  fallback: InventoryLocation = "CLEANERS_CUPBOARD"
): InventoryLocation {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^CLEANER_/, "CLEANERS_");
  return (INVENTORY_LOCATIONS as readonly string[]).includes(normalized)
    ? (normalized as InventoryLocation)
    : fallback;
}

export function inferInventoryLocationFromCategory(
  category: unknown,
  fallback: InventoryLocation = "CLEANERS_CUPBOARD"
): InventoryLocation {
  const text = String(category ?? "").trim().toLowerCase();
  if (text.includes("bath")) return "BATHROOM";
  if (text.includes("kitchen")) return "KITCHEN";
  if (text.includes("clean")) return "CLEANERS_CUPBOARD";
  return fallback;
}
