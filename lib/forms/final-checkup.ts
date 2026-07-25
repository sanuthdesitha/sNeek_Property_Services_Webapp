/**
 * Final check-up acknowledgement (R7) — pure logic shared by the form read
 * route (payload), the submit route (server gate), and the cleaner dialog.
 *
 * The admin defines items in AppSettings.finalCheckup; on top of those, two
 * kinds of auto-items are appended per job:
 *   - a guest-count item when the job has a reservation ("Guests this stay:
 *     4 — confirm setup"),
 *   - one item per admin special-request task on the job.
 *
 * The cleaner must acknowledge every resolved item before submit; the submit
 * route recomputes the list server-side and validates the acknowledgements.
 */

import type { FinalCheckupSettings } from "@/lib/settings";

export interface ResolvedFinalCheckupItem {
  id: string;
  title: string;
  detail?: string;
  referenceImageKeys: string[];
  source: "SETTINGS" | "GUESTS" | "ADMIN_REQUEST";
}

export interface FinalCheckupAckEntry {
  itemId: string;
  /** ISO timestamp of the tap. */
  at?: string;
}

/** Stable auto-item ids so client and server resolve identical lists. */
export const GUEST_CHECKUP_ITEM_ID = "auto-guest-count";
export const adminRequestCheckupItemId = (taskId: string) => `auto-admin-request-${taskId}`;

/**
 * Human guest summary from a reservation context (e.g. "4" / "4 (2 adults,
 * 2 children)"). Returns undefined when there is no usable guest data.
 */
export function guestSummaryFromReservation(
  reservation:
    | {
        preparationGuestCount?: number;
        adults?: number;
        children?: number;
        infants?: number;
      }
    | null
    | undefined
): string | undefined {
  if (!reservation) return undefined;
  const parts = [
    reservation.adults ? `${reservation.adults} adult${reservation.adults === 1 ? "" : "s"}` : null,
    reservation.children
      ? `${reservation.children} child${reservation.children === 1 ? "" : "ren"}`
      : null,
    reservation.infants ? `${reservation.infants} infant${reservation.infants === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];
  const summed =
    (reservation.adults ?? 0) + (reservation.children ?? 0) + (reservation.infants ?? 0);
  const total =
    typeof reservation.preparationGuestCount === "number" && reservation.preparationGuestCount > 0
      ? reservation.preparationGuestCount
      : summed > 0
        ? summed
        : undefined;
  if (total == null) return undefined;
  return parts.length > 0 ? `${total} (${parts.join(", ")})` : String(total);
}

/**
 * The ordered list of check-up items for a job: admin-configured items filtered
 * by `appliesTo` (empty/undefined = all job types), then the guest auto-item,
 * then one auto-item per admin special-request task. Disabled (or missing)
 * settings resolve to [] — no gate.
 */
export function resolveFinalCheckupItems(
  settings: { finalCheckup?: FinalCheckupSettings | null } | null | undefined,
  job: { jobType?: string | null } | null | undefined,
  extras: {
    guestSummary?: string;
    adminRequests: Array<{ id: string; title: string }>;
  }
): ResolvedFinalCheckupItem[] {
  const config = settings?.finalCheckup;
  if (!config?.enabled) return [];

  const jobType = job?.jobType ?? "";
  const items: ResolvedFinalCheckupItem[] = [];

  for (const item of config.items ?? []) {
    if (!item || !item.id || !item.title) continue;
    const appliesTo = Array.isArray(item.appliesTo) ? item.appliesTo.filter(Boolean) : [];
    if (appliesTo.length > 0 && !appliesTo.includes(jobType)) continue;
    items.push({
      id: item.id,
      title: item.title,
      ...(item.detail ? { detail: item.detail } : {}),
      referenceImageKeys: Array.isArray(item.referenceImageKeys) ? item.referenceImageKeys : [],
      source: "SETTINGS",
    });
  }

  const guestSummary = extras.guestSummary?.trim();
  if (guestSummary) {
    items.push({
      id: GUEST_CHECKUP_ITEM_ID,
      title: `Guests this stay: ${guestSummary} — confirm setup`,
      detail: "Confirm beds, towels and amenities are set up for this guest count.",
      referenceImageKeys: [],
      source: "GUESTS",
    });
  }

  for (const request of extras.adminRequests ?? []) {
    const id = typeof request?.id === "string" ? request.id.trim() : "";
    const title = typeof request?.title === "string" ? request.title.trim() : "";
    if (!id || !title) continue;
    items.push({
      id: adminRequestCheckupItemId(id),
      title: `Admin request: ${title}`,
      detail: "Confirm this admin-requested task is fully done before you leave.",
      referenceImageKeys: [],
      source: "ADMIN_REQUEST",
    });
  }

  return items;
}

/**
 * Validate an acknowledgement payload against the resolved items. Every item
 * must be acknowledged; extra/unknown acks are ignored. An empty item list
 * always passes (no gate).
 */
export function validateFinalCheckupAck(
  items: Array<Pick<ResolvedFinalCheckupItem, "id">>,
  ack: unknown
): { ok: true } | { ok: false; missingIds: string[] } {
  if (!Array.isArray(items) || items.length === 0) return { ok: true };
  const acked = new Set<string>();
  if (Array.isArray(ack)) {
    for (const entry of ack) {
      if (!entry || typeof entry !== "object") continue;
      const itemId = (entry as Record<string, unknown>).itemId;
      if (typeof itemId === "string" && itemId.trim()) acked.add(itemId.trim());
    }
  }
  const missingIds = items.map((i) => i.id).filter((id) => !acked.has(id));
  return missingIds.length === 0 ? { ok: true } : { ok: false, missingIds };
}
