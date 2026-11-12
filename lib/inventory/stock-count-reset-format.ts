/**
 * Client-safe shapes and wording for the "applied stock counts" question in
 * the reset dialogs (owner decision 2026-11-12). The server rules live in
 * lib/inventory/stock-count-reset.ts; this file only reads its answers.
 */
import type { AppliedCountChoice, AppliedStockCount, ResetCountResolution } from "./stock-count-reset";

export type { AppliedCountChoice, AppliedStockCount, ResetCountResolution };

export const STOCK_COUNT_CHOICE_REQUIRED_CODE = "STOCK_COUNT_CHOICE_REQUIRED";

export const APPLIED_COUNT_CHOICE_LABEL: Record<AppliedCountChoice, string> = {
  REVERSE: "Reverse these counts",
  KEEP: "Keep them",
};

export const APPLIED_COUNT_CHOICE_HINT: Record<AppliedCountChoice, string> = {
  REVERSE: "Put back the on-hand value each count replaced. An item with a newer stock record since the count is left as it is and reported.",
  KEEP: "Leave on-hand as counted. The decision is recorded on each count.",
};

/** "4 roll", or "unknown" for a missing value (never shown as zero). */
export function formatCountQuantity(value: number | null, unit: string | null): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  return unit ? `${value} ${unit}` : String(value);
}

/** Pure: the applied counts carried on a 409 STOCK_COUNT_CHOICE_REQUIRED body, else null. */
export function appliedCountsFromRefusal(body: unknown): AppliedStockCount[] | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { code?: unknown; appliedStockCounts?: unknown };
  if (record.code !== STOCK_COUNT_CHOICE_REQUIRED_CODE || !Array.isArray(record.appliedStockCounts)) return null;
  return record.appliedStockCounts as AppliedStockCount[];
}

/** Pure: one line saying what the reset did with the counts, or null when there were none. */
export function summarizeCountResolution(resolution: ResetCountResolution | null | undefined): string | null {
  if (!resolution || resolution.outcomes.length === 0) return null;
  const reversed = resolution.outcomes.filter((row) => row.outcome === "REVERSED").length;
  const kept = resolution.outcomes.filter((row) => row.outcome === "KEPT").length;
  const notReversed = resolution.outcomes.filter((row) => row.outcome === "NOT_REVERSED_NEWER_RECORD" || row.outcome === "NOT_REVERSED_NO_PRIOR_VALUE");
  const parts: string[] = [];
  if (reversed) parts.push(`${reversed} stock ${reversed === 1 ? "count" : "counts"} reversed`);
  if (kept) parts.push(`${kept} stock ${kept === 1 ? "count" : "counts"} kept`);
  if (notReversed.length) parts.push(`not reversed (newer record): ${notReversed.map((row) => row.itemName).join(", ")}`);
  return parts.join("; ");
}
