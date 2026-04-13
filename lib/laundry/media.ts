import type { MediaGalleryItem } from "@/components/shared/media-gallery";

type LaundryConfirmationLike = {
  id: string;
  photoUrl?: string | null;
  laundryReady?: boolean | null;
  notes?: string | null;
  meta?: Record<string, unknown> | null;
};

function readMeta(value: LaundryConfirmationLike) {
  if (value.meta && typeof value.meta === "object") return value.meta;
  if (!value.notes) return {};
  try {
    const parsed = JSON.parse(value.notes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseLaundryConfirmationMeta(notes: string | null | undefined) {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getLaundryConfirmationLabel(confirmation: LaundryConfirmationLike) {
  const meta = readMeta(confirmation);
  switch (String(meta.event ?? "").trim().toUpperCase()) {
    case "PICKED_UP":
      return "Pickup proof";
    case "DROPPED":
      return "Drop-off proof";
    case "FAILED_PICKUP_REQUEST":
      return "Failed pickup request";
    case "FAILED_PICKUP_RESCHEDULE":
      return "Failed pickup reschedule";
    case "FAILED_PICKUP_SKIP_APPROVED":
      return "Skip approval";
    case "FAILED_PICKUP_REQUEST_REJECTED":
      return "Rejected failed pickup request";
    default:
      return confirmation.laundryReady ? "Cleaner proof" : "Laundry update";
  }
}

export function buildLaundryConfirmationMediaItems(
  confirmations: LaundryConfirmationLike[] | null | undefined,
  options?: { receiptImageUrl?: string | null; receiptLabel?: string; taskId?: string | null }
) {
  const items: MediaGalleryItem[] = [];
  for (const confirmation of Array.isArray(confirmations) ? confirmations : []) {
    if (!confirmation?.photoUrl) continue;
    items.push({
      id: confirmation.id,
      url: confirmation.photoUrl,
      label: getLaundryConfirmationLabel(confirmation),
      mediaType: "PHOTO",
    });
  }
  if (options?.receiptImageUrl) {
    items.push({
      id: `${options.taskId ?? "laundry"}-receipt`,
      url: options.receiptImageUrl,
      label: options.receiptLabel ?? "Laundry receipt",
      mediaType: "PHOTO",
    });
  }
  return items;
}
