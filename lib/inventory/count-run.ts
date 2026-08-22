/**
 * WHAT A SCAN RUN MEANS FOR THE STOCK ON HAND.
 *
 * A count run is destructive in a way most inventory writes are not: approving
 * it REPLACES the stock figure rather than adjusting it, and anything the
 * cleaner did not scan drops to zero. That is the correct behaviour — a count
 * is a statement about the whole cupboard, and an item nobody found is an item
 * that is not there — but it also means a half-finished run silently wipes the
 * shelf.
 *
 * (Note this differs from the older stock-run apply path, which falls back to
 * the EXPECTED figure for any line left uncounted. That is safe but useless for
 * a scan run: everything nobody scanned would keep its old number, and the
 * count would only ever be able to say "there is more", never "there is none".)
 *
 * So the zeroing is never implicit. `reconcileCountRun` returns the items it
 * WOULD zero as their own list, so whoever approves is shown "these were not
 * scanned — are you sure you did not miss them?" and has to say yes. The cost
 * of that question is one tap; the cost of skipping it is a fortnight of
 * phantom shortages and an emergency shop.
 *
 * Two things are deliberately kept apart:
 *
 *   COUNTED   what the scans say is physically there, after the cleaner's edits.
 *   NEEDED    what to buy — par level minus counted — which is a separate
 *             judgement belonging to the shopping list, not to the count.
 *
 * Merging them is tempting and wrong: a property can be fully stocked and still
 * want nothing bought, and an item can sit at zero because it was deliberately
 * discontinued there.
 *
 * PURE — no DB, no I/O.
 */

/** An existing stock row at the property being counted. */
export interface StockLine {
  itemId: string;
  itemName: string;
  /** What the system believed before the count. */
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  /** Supplier string from the inventory item, for shopping grouping. */
  supplier?: string | null;
  unit?: string | null;
}

/** A scanned barcode resolved to an item, with the units it represents. */
export interface ResolvedScan {
  itemId: string;
  /** Scans multiplied by pack size. Already multiplied by the caller. */
  units: number;
}

/** A scan that matched no known barcode. */
export interface UnknownScan {
  code: string;
  scans: number;
}

export interface CountLine {
  itemId: string;
  itemName: string;
  /** What the system held before this run. */
  previousOnHand: number;
  /** What the count says is there now. */
  countedOnHand: number;
  parLevel: number;
  /** Positive when the count is higher than the system believed. */
  variance: number;
  /** How many to buy to reach par. Never negative. */
  needed: number;
  supplier?: string | null;
  unit?: string | null;
}

export interface CountRunReconciliation {
  /** Every item that was scanned or manually counted, with its new figure. */
  counted: CountLine[];
  /**
   * Stocked items nobody scanned. These would go to zero on approval, and are
   * the list the operator must confirm before that happens.
   */
  wouldZero: CountLine[];
  /** Scans that matched no item. Worth registering, not worth guessing at. */
  unknown: UnknownScan[];
  /** True when approving would set at least one item to zero. */
  requiresZeroConfirmation: boolean;
}

/**
 * Turn a set of resolved scans into the figures a count run would write.
 *
 * `overrides` are the cleaner's manual edits from the review screen, keyed by
 * item id. They WIN over the scan tally — the person at the cupboard can see a
 * bottle the scanner missed, and a system that argues with them is one they
 * stop using. An override of zero is honoured as zero, which is why this checks
 * for the key's presence rather than for a truthy value.
 */
export function reconcileCountRun(input: {
  stockLines: readonly StockLine[];
  scans: readonly ResolvedScan[];
  unknown?: readonly UnknownScan[];
  overrides?: Readonly<Record<string, number>>;
}): CountRunReconciliation {
  const scannedUnits = new Map<string, number>();
  for (const scan of input.scans) {
    const units = Number(scan.units);
    if (!Number.isFinite(units) || units < 0) continue;
    scannedUnits.set(scan.itemId, (scannedUnits.get(scan.itemId) ?? 0) + units);
  }

  const overrides = input.overrides ?? {};
  const counted: CountLine[] = [];
  const wouldZero: CountLine[] = [];

  for (const line of input.stockLines) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, line.itemId);
    const overrideValue = hasOverride ? Number(overrides[line.itemId]) : NaN;
    const overridden = hasOverride && Number.isFinite(overrideValue) && overrideValue >= 0;

    const wasScanned = scannedUnits.has(line.itemId);
    const countedOnHand = overridden
      ? overrideValue
      : wasScanned
        ? (scannedUnits.get(line.itemId) as number)
        : 0;

    const entry: CountLine = {
      itemId: line.itemId,
      itemName: line.itemName,
      previousOnHand: line.onHand,
      countedOnHand,
      parLevel: line.parLevel,
      variance: countedOnHand - line.onHand,
      // Par minus what is there, clamped at zero: being over par is not a
      // negative shopping quantity, it is simply nothing to buy.
      needed: Math.max(0, line.parLevel - countedOnHand),
      supplier: line.supplier ?? null,
      unit: line.unit ?? null,
    };

    // An item the cleaner explicitly typed a number for has been dealt with,
    // even when that number is zero — it does not belong in the "did you miss
    // these?" list, because they plainly did not.
    if (!wasScanned && !overridden) {
      // Already at zero before the run, so approving changes nothing and there
      // is nothing to warn about. Warning anyway would train people to click
      // through the confirmation on the occasion it matters.
      if (line.onHand > 0) wouldZero.push(entry);
      else counted.push(entry);
      continue;
    }

    counted.push(entry);
  }

  return {
    // Biggest discrepancy first: that is what a reviewer is scanning the list for.
    counted: counted.sort(
      (a, b) =>
        Math.abs(b.variance) - Math.abs(a.variance) || a.itemName.localeCompare(b.itemName)
    ),
    wouldZero: wouldZero.sort((a, b) => b.previousOnHand - a.previousOnHand),
    unknown: [...(input.unknown ?? [])].sort((a, b) => b.scans - a.scans),
    requiresZeroConfirmation: wouldZero.length > 0,
  };
}

/** One line of the shopping list a finished count implies. */
export interface ShoppingNeed {
  itemId: string;
  itemName: string;
  needed: number;
  supplier?: string | null;
  unit?: string | null;
}

/**
 * The shopping list a finished count implies.
 *
 * Only items genuinely below par. An item at or above par contributes nothing —
 * a shopping list padded with zero-quantity rows is one nobody reads to the
 * bottom of, which is how the thing that WAS needed gets missed.
 */
export function shoppingNeedsFromCount(
  reconciliation: CountRunReconciliation,
  options: { includeZeroed?: boolean } = {}
): ShoppingNeed[] {
  // Zeroed items are included by default: something that has run out is
  // precisely what needs buying. The option exists for the case where a zero
  // means "not stocked here any more" rather than "empty".
  const lines =
    options.includeZeroed === false
      ? reconciliation.counted
      : [...reconciliation.counted, ...reconciliation.wouldZero];

  return lines
    .filter((line) => line.needed > 0)
    .map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName,
      needed: line.needed,
      supplier: line.supplier ?? null,
      unit: line.unit ?? null,
    }))
    .sort((a, b) => b.needed - a.needed || a.itemName.localeCompare(b.itemName));
}
