/** Bulk action vocabulary for Lost and found. Pure; safe for client bundles. */
import type { LostFoundStatus } from "./status";

export const LOST_FOUND_BULK_ACTIONS = ["move-to-storage", "mark-unclaimed", "donate", "dispose"] as const;
export type LostFoundBulkAction = (typeof LOST_FOUND_BULK_ACTIONS)[number];

export const LOST_FOUND_BULK_TARGET: Record<LostFoundBulkAction, LostFoundStatus> = {
  "move-to-storage": "IN_STORAGE",
  "mark-unclaimed": "UNCLAIMED",
  donate: "DONATED",
  dispose: "DISPOSED",
};

export const LOST_FOUND_BULK_MAX = 100;

export type LostFoundBulkResult = { id: string; outcome: "done" | "unchanged" | "refused"; message: string };
