/**
 * Checklist coverage (board "Checklist coverage", 2026-11-17): row shape,
 * status words, the tile counts that filter, and the layout words. PURE.
 */
export type CoverageStatus = "NONE" | "DRAFT" | "APPROVED" | "STALE";

export type CoverageRow = {
  id: string;
  name: string;
  suburb: string;
  clientName: string;
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  hasFeatures: boolean;
  checklistStatus: CoverageStatus | string;
  approvedAt: string | null;
  profileCreatedAt?: string | null;
  profileUpdatedAt?: string | null;
  clientHasEmail?: boolean;
};

export type CoverageTile = "all" | "APPROVED" | "DRAFT" | "STALE" | "NONE" | "no-amenities";

export const TILE_LABEL: Record<CoverageTile, string> = {
  all: "All active properties",
  APPROVED: "Approved",
  DRAFT: "Draft, waiting for approval",
  STALE: "Needs review",
  NONE: "No checklist yet",
  "no-amenities": "Amenities not captured",
};

export function statusOf(row: CoverageRow): CoverageStatus {
  return row.checklistStatus === "APPROVED" || row.checklistStatus === "DRAFT" || row.checklistStatus === "STALE" ? row.checklistStatus : "NONE";
}

export function matchesTile(row: CoverageRow, tile: CoverageTile): boolean {
  if (tile === "all") return true;
  if (tile === "no-amenities") return !row.hasFeatures;
  return statusOf(row) === tile;
}

export type TileCounts = Record<CoverageTile, number>;

export function tileCounts(rows: readonly CoverageRow[]): TileCounts {
  const counts: TileCounts = { all: rows.length, APPROVED: 0, DRAFT: 0, STALE: 0, NONE: 0, "no-amenities": 0 };
  for (const row of rows) {
    counts[statusOf(row)] += 1;
    if (!row.hasFeatures) counts["no-amenities"] += 1;
  }
  return counts;
}

/** Days since the oldest draft was created, or null with no dated draft. */
export function oldestDraftDays(rows: readonly CoverageRow[], now: Date): number | null {
  const dates = rows.filter((row) => statusOf(row) === "DRAFT" && row.profileCreatedAt).map((row) => new Date(row.profileCreatedAt as string).getTime()).filter(Number.isFinite);
  if (dates.length === 0) return null;
  return Math.max(0, Math.floor((now.getTime() - Math.min(...dates)) / 86_400_000));
}

/** "3 bed · 2 bath · balcony"; 0 bedrooms reads "Bedrooms not set" (never "0bd"). */
export function layoutWords(row: Pick<CoverageRow, "bedrooms" | "bathrooms" | "hasBalcony">): string {
  const parts = [row.bedrooms > 0 ? `${row.bedrooms} bed` : "Bedrooms not set", row.bathrooms > 0 ? `${row.bathrooms} bath` : "Bathrooms not set"];
  if (row.hasBalcony) parts.push("balcony");
  return parts.join(" · ");
}

export const STATUS_WORDS: Record<CoverageStatus, { label: string; tone: "ok" | "warn" | "bad" }> = {
  APPROVED: { label: "Approved", tone: "ok" },
  DRAFT: { label: "Draft", tone: "warn" },
  STALE: { label: "Needs review", tone: "warn" },
  NONE: { label: "No checklist", tone: "bad" },
};

export function matchesSearch(row: CoverageRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.name} ${row.suburb} ${row.clientName}`.toLowerCase().includes(q);
}
