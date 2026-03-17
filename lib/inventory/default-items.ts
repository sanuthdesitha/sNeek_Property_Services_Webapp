import { db } from "@/lib/db";
import { type InventoryLocation } from "@/lib/inventory/locations";

export type DefaultInventoryItem = {
  sku: string;
  name: string;
  category: string;
  location: InventoryLocation;
  unit: string;
  supplier?: string;
  defaultParLevel: number;
  defaultThreshold: number;
};

export const DEFAULT_INVENTORY_ITEMS: DefaultInventoryItem[] = [
  { sku: "DEF-SHAMPOO", name: "Shampoo", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Woolworths", defaultParLevel: 8, defaultThreshold: 3 },
  { sku: "DEF-BODYWASH", name: "Body Wash", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Woolworths", defaultParLevel: 8, defaultThreshold: 3 },
  { sku: "DEF-CONDITIONER", name: "Conditioner", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Woolworths", defaultParLevel: 8, defaultThreshold: 3 },
  { sku: "DEF-HANDSOAP", name: "Hand Soap", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Woolworths", defaultParLevel: 6, defaultThreshold: 2 },
  { sku: "DEF-TP", name: "Toilet Paper", category: "Bathroom", location: "BATHROOM", unit: "roll", supplier: "Costco", defaultParLevel: 24, defaultThreshold: 8 },
  { sku: "DEF-PAPERTOWEL", name: "Paper Towels", category: "Kitchen", location: "KITCHEN", unit: "roll", supplier: "Costco", defaultParLevel: 8, defaultThreshold: 3 },
  { sku: "DEF-SCRUBPAD", name: "Kitchen Scrubbing Pads", category: "Kitchen", location: "KITCHEN", unit: "pack", supplier: "Bunnings", defaultParLevel: 6, defaultThreshold: 2 },
  { sku: "DEF-COFFEECAPS", name: "Coffee Capsules", category: "Kitchen", location: "KITCHEN", unit: "capsule", supplier: "Woolworths", defaultParLevel: 30, defaultThreshold: 10 },
  { sku: "DEF-TEABAG", name: "Tea Bags", category: "Kitchen", location: "KITCHEN", unit: "bag", supplier: "Woolworths", defaultParLevel: 40, defaultThreshold: 15 },
  { sku: "DEF-BINBAG-S", name: "Bin Bags (Small)", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bag", supplier: "Bunnings", defaultParLevel: 40, defaultThreshold: 15 },
  { sku: "DEF-BINBAG-L", name: "Bin Bags (Large)", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bag", supplier: "Bunnings", defaultParLevel: 25, defaultThreshold: 8 },
  { sku: "DEF-SPRAYWIPE", name: "Spray n Wipe", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bottle", supplier: "Bunnings", defaultParLevel: 4, defaultThreshold: 1 },
  { sku: "DEF-GLASSSPRAY", name: "Glass Spray", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bottle", supplier: "Bunnings", defaultParLevel: 4, defaultThreshold: 1 },
  { sku: "DEF-MOLDSPRAY", name: "Mold Spray", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bottle", supplier: "Bunnings", defaultParLevel: 3, defaultThreshold: 1 },
];

export async function ensureDefaultInventoryItems() {
  await db.inventoryItem.createMany({
    data: DEFAULT_INVENTORY_ITEMS.map((item) => ({
      sku: item.sku,
      name: item.name,
      category: item.category,
      location: item.location,
      unit: item.unit,
      supplier: item.supplier,
      isActive: true,
    })),
    skipDuplicates: true,
  });

  return db.inventoryItem.findMany({
    where: {
      sku: {
        in: DEFAULT_INVENTORY_ITEMS.map((item) => item.sku),
      },
      isActive: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function applyDefaultStockToProperty(propertyId: string, itemIds: string[]) {
  const defaultsBySku = new Map(DEFAULT_INVENTORY_ITEMS.map((item) => [item.sku, item]));
  const items = await db.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, sku: true },
  });

  for (const item of items) {
    const defaults = item.sku ? defaultsBySku.get(item.sku) : undefined;
    const parLevel = defaults?.defaultParLevel ?? 6;
    const threshold = defaults?.defaultThreshold ?? 2;

    await db.propertyStock.upsert({
      where: {
        propertyId_itemId: {
          propertyId,
          itemId: item.id,
        },
      },
      create: {
        propertyId,
        itemId: item.id,
        onHand: parLevel,
        parLevel,
        reorderThreshold: threshold,
      },
      update: {},
    });
  }
}
