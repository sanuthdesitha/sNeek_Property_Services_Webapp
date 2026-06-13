/**
 * Shared types + helpers for the expanded QA inspection tools.
 *
 * These structures are persisted on the QA submission `data` JSON (under the
 * reserved `__qaTools` key) so the inspector's structured work (damage, next-
 * clean requests, restock, inventory count, on-site time, rework transfer)
 * travels with the submission and can be replayed on the admin/cleaner side.
 *
 * The heavy lifting (creating Cases, StockRuns, QaReworkTransfer rows) happens
 * server-side in the QA submission route — these types are the wire contract
 * between the QA client and that route.
 */
import type { QaReworkSeverity } from "@prisma/client";

/** A single itemized damage finding. */
export interface QaDamageEntry {
  /** Stable client-side id for list keys. */
  id: string;
  area: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** S3 keys for the damage photos (uploaded via the shared uploader). */
  photoKeys: string[];
  estimatedCost?: number | null;
}

/** A "do this next clean" / special request that attaches to the property. */
export interface QaNextCleanRequest {
  id: string;
  /** "DEEP_CLEAN_AREA" focuses a specific area next time; "SPECIAL_REQUEST" is freeform. */
  kind: "DEEP_CLEAN_AREA" | "SPECIAL_REQUEST";
  area?: string | null;
  note: string;
}

/** A restock line — qty to order for a given property-stock row. */
export interface QaRestockLine {
  propertyStockId: string;
  /** Quantity flagged for restock (informational; the run is a DRAFT). */
  quantity: number;
  note?: string | null;
}

/** A full-count line — the inspector's observed on-hand for a property-stock row. */
export interface QaInventoryCountLine {
  propertyStockId: string;
  countedOnHand: number;
  note?: string | null;
}

/** The cleaner↔QA rework transfer proposal captured on submit. */
export interface QaReworkProposal {
  /** Whether the inspector wants to file a transfer at all. */
  enabled: boolean;
  cleanerUserId: string | null;
  severity: QaReworkSeverity;
  reason: string;
  /** Areas/items the cleaner missed and the QA redid. */
  areas: string[];
  minutesFromCleaner: number;
  amountFromCleaner: number;
  affectsCleanerStats: boolean;
}

/** Everything the inspector captured beyond the scored form. */
export interface QaInspectionTools {
  damage: QaDamageEntry[];
  nextClean: QaNextCleanRequest[];
  restock: QaRestockLine[];
  inventoryCount: QaInventoryCountLine[];
  /**
   * Per-section QA photos keyed by the QA template section id. These are the
   * inspector's own evidence shots attached to a specific checklist section —
   * SEPARATE from the itemized damage photos (which live on each damage entry).
   * The value is a list of S3 keys (resolved to URLs for display/PDF).
   */
  sectionPhotos: Record<string, string[]>;
  onSite: {
    startedAt: string | null;
    endedAt: string | null;
    minutes: number | null;
  };
  rework: QaReworkProposal | null;
}

export const QA_TOOLS_DATA_KEY = "__qaTools";

export function emptyReworkProposal(): QaReworkProposal {
  return {
    enabled: false,
    cleanerUserId: null,
    severity: "MINOR",
    reason: "",
    areas: [],
    minutesFromCleaner: 0,
    amountFromCleaner: 0,
    affectsCleanerStats: true,
  };
}

export function emptyInspectionTools(): QaInspectionTools {
  return {
    damage: [],
    nextClean: [],
    restock: [],
    inventoryCount: [],
    sectionPhotos: {},
    onSite: { startedAt: null, endedAt: null, minutes: null },
    rework: null,
  };
}

/** Compute whole minutes between two ISO timestamps (>=0). */
export function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.round((end - start) / 60_000));
}
