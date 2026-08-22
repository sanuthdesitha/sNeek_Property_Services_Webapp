/**
 * ONE TROLLEY, MANY PROPERTIES.
 *
 * Whoever is doing the shopping is standing in one aisle holding one basket.
 * They do not care that four bottles are for Bondi and two are for Coogee —
 * they care that they need six bottles. But the moment they get back to the
 * car, that breakdown is the only thing that matters, because six bottles have
 * to be split into two drops.
 *
 * So this returns BOTH on the same row: a single quantity to buy, and the
 * per-property split it came from. `groupShoppingRows` in shopping-grouping.ts
 * is the other half of the picture — it buckets rows under a heading for
 * display without ever adding them up. This does the arithmetic.
 *
 * Keeping the two separate matters: a grouped view of six one-bottle rows and a
 * consolidated row of six bottles look similar on screen and are completely
 * different instructions to a person in a shop.
 *
 * PURE — no DB, no I/O.
 */

export interface PropertyNeed {
  propertyId: string;
  propertyName: string;
  itemId: string;
  itemName: string;
  needed: number;
  supplier?: string | null;
  unit?: string | null;
  category?: string | null;
}

export interface ConsolidatedLine {
  itemId: string;
  itemName: string;
  /** What to actually put in the basket. */
  totalNeeded: number;
  supplier: string | null;
  unit: string | null;
  category: string | null;
  /** Where it goes once bought. Largest drop first. */
  breakdown: Array<{ propertyId: string; propertyName: string; needed: number }>;
  /** How many properties are waiting on this item. */
  propertyCount: number;
}

/**
 * Add up what to buy, and remember who it is for.
 *
 * A property appearing twice for the same item — two count runs in a day, or a
 * manual addition on top of a run — is SUMMED rather than max'd. Taking the
 * larger would quietly discard a genuine second request; and if the duplication
 * is a mistake, an over-buy is visible on the shelf while a short-buy is not.
 */
export function consolidateShoppingNeeds(needs: readonly PropertyNeed[]): ConsolidatedLine[] {
  const byItem = new Map<string, ConsolidatedLine>();

  for (const need of needs) {
    const quantity = Number(need.needed);
    // Zero and nonsense contribute nothing. A list padded with zero-quantity
    // rows is one nobody reads to the bottom of.
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const existing = byItem.get(need.itemId);
    if (!existing) {
      byItem.set(need.itemId, {
        itemId: need.itemId,
        itemName: need.itemName,
        totalNeeded: quantity,
        supplier: need.supplier ?? null,
        unit: need.unit ?? null,
        category: need.category ?? null,
        breakdown: [
          { propertyId: need.propertyId, propertyName: need.propertyName, needed: quantity },
        ],
        propertyCount: 1,
      });
      continue;
    }

    existing.totalNeeded += quantity;

    const line = existing.breakdown.find((row) => row.propertyId === need.propertyId);
    if (line) {
      line.needed += quantity;
    } else {
      existing.breakdown.push({
        propertyId: need.propertyId,
        propertyName: need.propertyName,
        needed: quantity,
      });
      existing.propertyCount += 1;
    }

    // Fill in details a later row knows and an earlier one did not — the first
    // property to want an item is not necessarily the one with a supplier set.
    existing.supplier = existing.supplier ?? need.supplier ?? null;
    existing.unit = existing.unit ?? need.unit ?? null;
    existing.category = existing.category ?? need.category ?? null;
  }

  return Array.from(byItem.values())
    .map((line) => ({
      ...line,
      breakdown: line.breakdown.sort(
        (a, b) => b.needed - a.needed || a.propertyName.localeCompare(b.propertyName)
      ),
    }))
    // Most-wanted first: someone working down a list in a shop wants the big
    // shared items early, while they still have trolley space and patience.
    .sort((a, b) => b.totalNeeded - a.totalNeeded || a.itemName.localeCompare(b.itemName));
}

/** Everything one supplier can fill, so a trip is one shop rather than four. */
export interface SupplierBasket {
  supplier: string;
  lines: ConsolidatedLine[];
  itemCount: number;
  totalUnits: number;
}

/** Heading for items with no supplier set. */
export const NO_SUPPLIER_LABEL = "No supplier set";

/**
 * Split a consolidated list into one basket per supplier.
 *
 * Items with no supplier are gathered under their own heading rather than
 * dropped: they still have to be bought, and hiding them because nobody filled
 * in a field is how a shop trip comes back incomplete.
 */
export function basketsBySupplier(lines: readonly ConsolidatedLine[]): SupplierBasket[] {
  const baskets = new Map<string, ConsolidatedLine[]>();

  for (const line of lines) {
    const key = line.supplier?.trim() || NO_SUPPLIER_LABEL;
    const bucket = baskets.get(key);
    if (bucket) bucket.push(line);
    else baskets.set(key, [line]);
  }

  return Array.from(baskets.entries())
    .map(([supplier, supplierLines]) => ({
      supplier,
      lines: supplierLines,
      itemCount: supplierLines.length,
      totalUnits: supplierLines.reduce((sum, line) => sum + line.totalNeeded, 0),
    }))
    .sort((a, b) => {
      // The unassigned pile sorts last wherever it falls alphabetically: it is
      // a loose end to tidy, not a shop to visit.
      if (a.supplier === NO_SUPPLIER_LABEL) return 1;
      if (b.supplier === NO_SUPPLIER_LABEL) return -1;
      return b.itemCount - a.itemCount || a.supplier.localeCompare(b.supplier);
    });
}
