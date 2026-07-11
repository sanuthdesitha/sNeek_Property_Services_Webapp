/**
 * Shared Lost & Found status vocabulary — used by both the API routes (server)
 * and the Estate / v1 UIs (client). No Prisma import so it is safe to pull into
 * client bundles; the API casts these string literals onto `LostFoundStatus`.
 */

export const LOST_FOUND_STATUSES = [
  "REPORTED",
  "IN_STORAGE",
  "GUEST_CONTACTED",
  "RETURN_OFFERED",
  "RETURNED",
  "DISPOSED",
  "DONATED",
  "UNCLAIMED",
  "ARCHIVED",
] as const;

export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

/** Statuses that mark a final decision — these set resolvedAt / resolvedByUserId. */
export const RESOLVED_STATUSES = ["RETURNED", "DISPOSED", "DONATED", "UNCLAIMED"] as const;
export type ResolvedStatus = (typeof RESOLVED_STATUSES)[number];

/** Statuses an item can move through before a final decision is recorded. */
export const WORKFLOW_STATUSES = [
  "REPORTED",
  "IN_STORAGE",
  "GUEST_CONTACTED",
  "RETURN_OFFERED",
] as const;

export function isResolvedStatus(status: string): status is ResolvedStatus {
  return (RESOLVED_STATUSES as readonly string[]).includes(status);
}

/** "Open" = still needs handling (not resolved, not archived). */
export function isOpenStatus(status: string): boolean {
  return !isResolvedStatus(status) && status !== "ARCHIVED";
}

export const LOST_FOUND_STATUS_LABELS: Record<LostFoundStatus, string> = {
  REPORTED: "Reported",
  IN_STORAGE: "In storage",
  GUEST_CONTACTED: "Guest contacted",
  RETURN_OFFERED: "Return offered",
  RETURNED: "Returned",
  DISPOSED: "Disposed",
  DONATED: "Donated",
  UNCLAIMED: "Unclaimed",
  ARCHIVED: "Archived",
};

export type LostFoundTone =
  | "neutral"
  | "primary"
  | "gold"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "aubergine";

export const LOST_FOUND_STATUS_TONES: Record<LostFoundStatus, LostFoundTone> = {
  REPORTED: "info",
  IN_STORAGE: "primary",
  GUEST_CONTACTED: "warning",
  RETURN_OFFERED: "gold",
  RETURNED: "success",
  DISPOSED: "neutral",
  DONATED: "aubergine",
  UNCLAIMED: "danger",
  ARCHIVED: "neutral",
};

/** Event action vocabulary appended to the item timeline. */
export const LOST_FOUND_EVENT_ACTIONS = [
  "REPORTED",
  "COMMENT",
  "OFFER_RETURN",
  "GUEST_CONTACTED",
  "STATUS_CHANGE",
  "RETURNED",
  "DISPOSED",
  "DONATED",
  "UNCLAIMED",
] as const;

export const LOST_FOUND_EVENT_LABELS: Record<string, string> = {
  REPORTED: "Reported found",
  COMMENT: "Comment",
  OFFER_RETURN: "Return offered",
  GUEST_CONTACTED: "Guest contacted",
  STATUS_CHANGE: "Status changed",
  RETURNED: "Returned to guest",
  DISPOSED: "Disposed",
  DONATED: "Donated",
  UNCLAIMED: "Marked unclaimed",
};

export function lostFoundStatusLabel(status: string): string {
  return LOST_FOUND_STATUS_LABELS[status as LostFoundStatus] ?? status;
}
