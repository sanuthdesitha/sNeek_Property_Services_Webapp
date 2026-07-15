/**
 * ESTATE laundry admin — shared status helpers, task typing and media builders
 * used across the v2 admin laundry workspace (Today / Live / Completed / Reports).
 * Pure helpers only; no JSX. Estate token styling lives in the consuming files.
 */
import { LaundryStatus } from "@prisma/client";
import type { MediaGalleryItem } from "@/components/shared/media-gallery";
import { buildLaundryConfirmationMediaItems } from "@/lib/laundry/media";

export type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

/** Status tones mirror the v1 admin colour language, mapped onto Estate tones. */
export function statusTone(status: string): Tone {
  switch (status) {
    case LaundryStatus.PENDING:
      return "neutral";
    case LaundryStatus.CONFIRMED:
      return "primary";
    case LaundryStatus.PICKED_UP:
      return "info";
    case LaundryStatus.DROPPED:
      return "success";
    case LaundryStatus.FLAGGED:
      return "danger";
    case LaundryStatus.SKIPPED_PICKUP:
      return "warning";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case LaundryStatus.PENDING:
      return "Pending";
    case LaundryStatus.CONFIRMED:
      return "Confirmed";
    case LaundryStatus.PICKED_UP:
      return "Picked up";
    case LaundryStatus.DROPPED:
      return "Delivered";
    case LaundryStatus.FLAGGED:
      return "Flagged";
    case LaundryStatus.SKIPPED_PICKUP:
      return "Skipped";
    default:
      return String(status ?? "").replace(/_/g, " ");
  }
}

/** All selectable statuses for the edit dialog (matches v1's STATUS_COLORS keys). */
export const LAUNDRY_STATUS_OPTIONS: LaundryStatus[] = [
  LaundryStatus.PENDING,
  LaundryStatus.CONFIRMED,
  LaundryStatus.PICKED_UP,
  LaundryStatus.DROPPED,
  LaundryStatus.FLAGGED,
  LaundryStatus.SKIPPED_PICKUP,
];

/** Loose shape of a task from GET /api/laundry/week (all LaundryTask scalars + relations). */
export type LaundryTaskDTO = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  flagReason?: string | null;
  flagNotes?: string | null;
  skipReasonCode?: string | null;
  skipReasonNote?: string | null;
  adminOverrideNote?: string | null;
  bagWeightKg?: number | null;
  dropoffCostAud?: number | null;
  receiptImageUrl?: string | null;
  pickupKeyPhotoUrl?: string | null;
  dropoffKeyPhotoUrl?: string | null;
  confirmedAt?: string | null;
  pickedUpAt?: string | null;
  droppedAt?: string | null;
  noPickupRequired?: boolean;
  createdAt?: string | null;
  property?: {
    id?: string;
    name?: string | null;
    suburb?: string | null;
    address?: string | null;
    client?: { id?: string; name?: string | null; email?: string | null } | null;
  } | null;
  supplier?: { id?: string; name?: string | null; pricePerKg?: number | null } | null;
  job?: { scheduledDate?: string | null; status?: string | null } | null;
  confirmations?: Array<{
    id: string;
    photoUrl?: string | null;
    laundryReady?: boolean | null;
    notes?: string | null;
    createdAt?: string | null;
  }> | null;
};

const COMPLETED_STATUSES = new Set<string>([LaundryStatus.DROPPED, LaundryStatus.SKIPPED_PICKUP]);
export function isCompleted(task: LaundryTaskDTO): boolean {
  return COMPLETED_STATUSES.has(task.status);
}

/**
 * Full media set for a task: cleaner/pickup/drop-off confirmation photos +
 * receipt (via lib/laundry/media) plus the pickup/drop-off key photos.
 */
export function buildTaskMedia(task: LaundryTaskDTO): MediaGalleryItem[] {
  const items = buildLaundryConfirmationMediaItems(task.confirmations ?? [], {
    receiptImageUrl: task.receiptImageUrl ?? null,
    taskId: task.id,
  });
  if (task.pickupKeyPhotoUrl) {
    items.push({ id: `${task.id}-pickup-key`, url: task.pickupKeyPhotoUrl, label: "Pickup key", mediaType: "PHOTO" });
  }
  if (task.dropoffKeyPhotoUrl) {
    items.push({ id: `${task.id}-dropoff-key`, url: task.dropoffKeyPhotoUrl, label: "Drop-off key", mediaType: "PHOTO" });
  }
  return items;
}

export function mediaCount(task: LaundryTaskDTO): number {
  return buildTaskMedia(task).length;
}
