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
  /** Per-photo markup (overlay PNG + comment) keyed by the photo's S3 key. */
  annotations?: Record<string, { overlayKey?: string; comment?: string }>;
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

/** A single QA-flagged area for a rework job: what to fix + the photo QA took. */
export interface QaFlaggedArea {
  id: string;
  label: string;
  note?: string;
  /** S3 keys of the photos QA captured of the problem. */
  photoKeys: string[];
  /** Per-photo markup (overlay PNG + comment) keyed by the photo's S3 key. */
  annotations?: Record<string, { overlayKey?: string; comment?: string }>;
}

/** The rework proposal captured on a failed QA inspection. */
export interface QaReworkProposal {
  /** Whether the inspector wants to send this clean back for rework at all. */
  enabled: boolean;
  /** The original cleaner (whose work failed) — used for stats + deduction. */
  cleanerUserId: string | null;
  severity: QaReworkSeverity;
  reason: string;
  /** Legacy flat labels (kept for stats/compat). */
  areas: string[];
  /** Structured flagged areas (each with QA photos) → the rework checklist. */
  flaggedAreas: QaFlaggedArea[];
  /** Hours QA allocates to the rework — drives the rework job's estimated hours
   *  (and hence the pay basis). Null → inherit the original job's estimate. */
  allocatedHours: number | null;
  /** Present the cleaner's fix checklist grouped by area (true) or flat (false). */
  categorized: boolean;
  /** Who redoes it: the SAME cleaner (no pay) or a DIFFERENT cleaner (paid). */
  assignee: "SAME" | "OTHER";
  /** When assignee = OTHER: the cleaner who will be paid for the rework. */
  payeeCleanerId: string | null;
  /** When assignee = OTHER: amount paid to them and deducted from the original. */
  payAmount: number;
  // ── Legacy cleaner→QA transfer fields (still supported for pay-to-QA) ──
  minutesFromCleaner: number;
  amountFromCleaner: number;
  affectsCleanerStats: boolean;
}

/** The inspector's formal sign-off, captured at submit time. */
export interface QaSignOff {
  /** S3 key of the inspector's drawn signature PNG. */
  signatureKey: string | null;
  /** The inspector ticked the attestation checkbox. */
  attested: boolean;
  /** Name captured at the moment of signing (from the session). */
  signedByName: string | null;
  /** ISO timestamp the inspection was signed. */
  signedAt: string | null;
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
  /**
   * Per-photo markup, keyed by the original S3 key. `overlayKey` is a transparent
   * PNG (draw strokes + numbered pins) layered over the original; `comment` is
   * the QA note shown to the cleaner. These flow into the reclean form.
   */
  mediaAnnotations: Record<string, { overlayKey?: string; comment?: string }>;
  onSite: {
    startedAt: string | null;
    endedAt: string | null;
    minutes: number | null;
  };
  rework: QaReworkProposal | null;
  /** The inspector's signature + attestation (set at submit). */
  signOff: QaSignOff | null;
}

export const QA_TOOLS_DATA_KEY = "__qaTools";

export function emptyReworkProposal(): QaReworkProposal {
  return {
    enabled: false,
    cleanerUserId: null,
    severity: "MINOR",
    reason: "",
    areas: [],
    flaggedAreas: [],
    allocatedHours: null,
    categorized: true,
    assignee: "SAME",
    payeeCleanerId: null,
    payAmount: 0,
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
    mediaAnnotations: {},
    onSite: { startedAt: null, endedAt: null, minutes: null },
    rework: null,
    signOff: null,
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
