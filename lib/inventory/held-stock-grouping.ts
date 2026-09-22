type HoldingItem = { id: string; name: string; unit: string; category?: string };
type HoldingEntry = { id?: string; heldStockId?: string; quantity: number; item: HoldingItem | null };

/** Call for one holder at a time. Keep source entries intact for edits and deliveries. */
export function groupHeldStock<T extends HoldingEntry>(rows: T[]) {
  const groups = new Map<string, { key: string; item: HoldingItem | null; category: string; quantity: number; entries: T[] }>();
  rows.forEach((row, index) => {
    // Never combine unrelated catalogue items or quantities measured in different units.
    const key = row.item ? JSON.stringify([row.item.id, row.item.unit]) : `unknown:${row.id ?? row.heldStockId ?? index}`;
    const group = groups.get(key) ?? { key, item: row.item, category: row.item?.category?.trim() || "Uncategorised", quantity: 0, entries: [] };
    group.quantity += row.quantity;
    group.entries.push(row);
    groups.set(key, group);
  });
  return Array.from(groups.values()).sort((a, b) => a.category.localeCompare(b.category) || (a.item?.name ?? "Unknown item").localeCompare(b.item?.name ?? "Unknown item") || a.key.localeCompare(b.key));
}
