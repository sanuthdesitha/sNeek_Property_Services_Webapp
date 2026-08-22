/**
 * QUICK SCAN — point the phone at a thing and change one number.
 *
 * Modelled on the scan-and-adjust tools warehouse staff already know (Shopify's
 * Stocky, Handy, Dandy and the rest): you pick a MODE once, then scan
 * repeatedly, and every scan applies that mode. The mode is sticky precisely
 * because the alternative — choosing an action after each scan — is two taps
 * per item, and nobody counting forty items does that twice.
 *
 * THIS IS NOT A COUNT RUN. `count-run.ts` reconciles the whole cupboard, where
 * an item nobody scanned is an item that is not there, so it zeroes. Quick scan
 * makes the opposite promise: it touches ONLY what you point at and leaves
 * everything else exactly as it was. Mixing the two would be catastrophic — a
 * cleaner topping up one shelf would silently empty the rest of the room.
 *
 * THE MODES, and why each exists:
 *
 *   INCREMENT  the default. Putting stock away: scan each item as it lands.
 *   DECREMENT  taking stock out. Scan as you use it.
 *   SET        you counted this one shelf properly and know the real number.
 *   SHOW       look, change nothing. The safety valve — someone unsure what a
 *              mode will do can check first, and a mode that cannot be checked
 *              is one people avoid entirely.
 *   TRANSFER   the same stock moving between properties. One scan, two writes:
 *              out of here, into there. Recording it instead as a decrement at
 *              one end and an increment at the other, minutes apart, is how
 *              stock appears to "disappear" in the report in between.
 *
 * PURE — no DB, no I/O.
 */

export type QuickScanMode = "INCREMENT" | "DECREMENT" | "SET" | "SHOW" | "TRANSFER";

export const QUICK_SCAN_MODES: QuickScanMode[] = [
  "INCREMENT",
  "DECREMENT",
  "SET",
  "SHOW",
  "TRANSFER",
];

export const QUICK_SCAN_LABELS: Record<QuickScanMode, { label: string; hint: string }> = {
  INCREMENT: { label: "Add", hint: "Each scan adds one" },
  DECREMENT: { label: "Remove", hint: "Each scan takes one away" },
  SET: { label: "Set", hint: "Scan, then type the real number" },
  SHOW: { label: "Check", hint: "Look only — nothing changes" },
  TRANSFER: { label: "Move", hint: "Send stock to another property" },
};

/** Modes that write. SHOW is deliberately absent. */
export function modeWrites(mode: QuickScanMode): boolean {
  return mode !== "SHOW";
}

/** Modes where the person must supply a number before anything happens. */
export function modeNeedsQuantity(mode: QuickScanMode): boolean {
  return mode === "SET" || mode === "TRANSFER";
}

export interface QuickScanOutcome {
  /** What the stock becomes at the scanned property. Unchanged for SHOW. */
  nextOnHand: number;
  /** Signed change, for the ledger. Zero when nothing moved. */
  delta: number;
  /** Nothing was written — SHOW, or a change that amounts to nothing. */
  noop: boolean;
  /** Why, when it could not be applied. */
  error?: "NEGATIVE_STOCK" | "QUANTITY_REQUIRED" | "SAME_PROPERTY";
}

/**
 * Work out what one scan does.
 *
 * `step` defaults to 1 but carries the barcode's pack size, so scanning a
 * carton in Add mode adds twelve — the same rule the count run uses, because a
 * carton is a carton whichever screen you are on.
 */
export function applyQuickScan(input: {
  mode: QuickScanMode;
  currentOnHand: number;
  /** Units per scan. A carton barcode is worth more than one. */
  step?: number;
  /** Required for SET (the new figure) and TRANSFER (how many to move). */
  quantity?: number | null;
  /** TRANSFER only. */
  fromPropertyId?: string;
  toPropertyId?: string | null;
}): QuickScanOutcome {
  const current = Number.isFinite(input.currentOnHand) ? input.currentOnHand : 0;
  const rawStep = Number(input.step);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;

  if (input.mode === "SHOW") {
    return { nextOnHand: current, delta: 0, noop: true };
  }

  if (modeNeedsQuantity(input.mode)) {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { nextOnHand: current, delta: 0, noop: true, error: "QUANTITY_REQUIRED" };
    }

    if (input.mode === "SET") {
      const delta = quantity - current;
      // Setting a shelf to the number it already holds is not an edit. A
      // zero-delta ledger line would fill the stock history with rows that
      // record nothing happening.
      return { nextOnHand: quantity, delta, noop: delta === 0 };
    }

    // TRANSFER
    if (!input.toPropertyId) {
      return { nextOnHand: current, delta: 0, noop: true, error: "QUANTITY_REQUIRED" };
    }
    if (input.toPropertyId === input.fromPropertyId) {
      // Moving stock to where it already is would write two ledger lines that
      // cancel out while implying the stock went somewhere.
      return { nextOnHand: current, delta: 0, noop: true, error: "SAME_PROPERTY" };
    }
    if (quantity > current) {
      // You cannot send what is not on the shelf. Allowing it would leave a
      // negative source and an invented positive at the destination.
      return { nextOnHand: current, delta: 0, noop: true, error: "NEGATIVE_STOCK" };
    }
    return { nextOnHand: current - quantity, delta: -quantity, noop: quantity === 0 };
  }

  const delta = input.mode === "INCREMENT" ? step : -step;
  const next = current + delta;

  if (next < 0) {
    // Refused rather than clamped. Clamping to zero would silently record a
    // smaller decrement than the cleaner actually performed, and the difference
    // would surface much later as unexplained shrinkage.
    return { nextOnHand: current, delta: 0, noop: true, error: "NEGATIVE_STOCK" };
  }

  return { nextOnHand: next, delta, noop: delta === 0 };
}

/** Plain-language refusals, for someone holding a phone at a shelf. */
export const QUICK_SCAN_ERROR_MESSAGE: Record<NonNullable<QuickScanOutcome["error"]>, string> = {
  NEGATIVE_STOCK: "That would take the shelf below zero. Check the number and try again.",
  QUANTITY_REQUIRED: "Enter how many first.",
  SAME_PROPERTY: "Pick a different property to move it to.",
};

/** The ledger note for one quick scan, so the history explains itself. */
export function quickScanNote(input: {
  mode: QuickScanMode;
  previous: number;
  next: number;
  toPropertyName?: string | null;
}): string {
  const base = `Quick scan · ${QUICK_SCAN_LABELS[input.mode].label}`;
  const movement = `${input.previous} → ${input.next}`;
  if (input.mode === "TRANSFER" && input.toPropertyName) {
    return `${base} to ${input.toPropertyName} · ${movement}`;
  }
  return `${base} · ${movement}`;
}
