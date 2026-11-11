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
  "REOPENED",
  "GUEST_IMPORTED",
  "CLIENT_CONTACTED",
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
  REOPENED: "Reopened",
  GUEST_IMPORTED: "Guest details added from booking",
  CLIENT_CONTACTED: "Client told",
};

export function lostFoundStatusLabel(status: string): string {
  return LOST_FOUND_STATUS_LABELS[status as LostFoundStatus] ?? status;
}

/**
 * Office stages on the Lost and found page. Each maps onto EXISTING statuses
 * (the statuses themselves are unchanged); "Closed" covers every final status
 * plus ARCHIVED.
 */
export const LOST_FOUND_STAGES = ["new", "storage", "contacted", "return", "closed"] as const;
export type LostFoundStage = (typeof LOST_FOUND_STAGES)[number];

export const LOST_FOUND_STAGE_STATUSES: Record<LostFoundStage, LostFoundStatus[]> = {
  new: ["REPORTED"],
  storage: ["IN_STORAGE"],
  contacted: ["GUEST_CONTACTED"],
  return: ["RETURN_OFFERED"],
  closed: ["RETURNED", "DISPOSED", "DONATED", "UNCLAIMED", "ARCHIVED"],
};

export const LOST_FOUND_STAGE_LABELS: Record<LostFoundStage, string> = {
  new: "New",
  storage: "In storage",
  contacted: "Guest contacted",
  return: "Return arranged",
  closed: "Closed",
};

export function lostFoundStageOf(status: string): LostFoundStage {
  for (const stage of LOST_FOUND_STAGES) {
    if ((LOST_FOUND_STAGE_STATUSES[stage] as string[]).includes(status)) return stage;
  }
  return "closed";
}

/** Statuses that count toward the holding period ("in storage or awaiting the guest"). */
export const HOLDING_STATUSES: LostFoundStatus[] = ["IN_STORAGE", "GUEST_CONTACTED", "RETURN_OFFERED"];

/** Statuses that are closed: every final decision plus ARCHIVED. */
export const CLOSED_STATUSES: LostFoundStatus[] = LOST_FOUND_STAGE_STATUSES.closed;

/** Where an item's guest details came from. */
export type LostFoundGuestSource = "BOOKING" | "MANUAL";
