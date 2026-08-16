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

const LAUNDRY_OUTCOME_TEXT: Record<string, string> = {
  READY_FOR_PICKUP: "Marked ready for pickup",
  NOT_READY: "Marked not ready",
  NO_PICKUP_REQUIRED: "No pickup needed",
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A human sentence for one laundry update.
 *
 * `LaundryConfirmation.notes` is a JSON envelope the cleaner/driver apps write
 * ({"event":"DROPPED","dropoffLocation":"Front door",...}). Surfaces that
 * printed `notes` directly showed the client that raw JSON — keys, S3 object
 * keys and ISO timestamps — which is both unreadable and leaks internal storage
 * paths.
 *
 * Returns null when there is nothing worth saying, so callers can omit the line
 * rather than render an empty one. A note that is NOT JSON is genuine free text
 * a person typed, and is passed through unchanged.
 */
export function describeLaundryConfirmation(confirmation: LaundryConfirmationLike): string | null {
  const meta = readMeta(confirmation);

  // Not JSON at all -> a real typed note. Show it as written.
  if (Object.keys(meta).length === 0) return asText(confirmation.notes);

  const parts: string[] = [];
  const event = String(meta.event ?? "").trim().toUpperCase();

  switch (event) {
    case "PICKED_UP": {
      const bags = typeof meta.bagCount === "number" ? meta.bagCount : null;
      parts.push(bags ? `Picked up — ${bags} bag${bags === 1 ? "" : "s"}` : "Picked up");
      break;
    }
    case "DROPPED": {
      const where = asText(meta.dropoffLocation);
      parts.push(where ? `Returned to ${where}` : "Returned");
      const early = asText(meta.earlyDropoffReason);
      if (early) parts.push(`Returned early — ${early}`);
      break;
    }
    case "FAILED_PICKUP_REQUEST":
      parts.push("Pickup could not be completed");
      break;
    case "FAILED_PICKUP_RESCHEDULE":
      parts.push("Pickup rescheduled");
      break;
    case "FAILED_PICKUP_SKIP_APPROVED":
      parts.push("Pickup skipped");
      break;
    case "FAILED_PICKUP_REQUEST_REJECTED":
      parts.push("Skip request declined");
      break;
    default: {
      // The early-update envelope carries an outcome rather than an event.
      const outcome = String(meta.laundryOutcome ?? "").trim().toUpperCase();
      if (outcome) parts.push(LAUNDRY_OUTCOME_TEXT[outcome] ?? "Laundry updated");
      break;
    }
  }

  // Any human-written note travelling inside the envelope.
  const note = asText(meta.reasonNote) ?? asText(meta.note);
  if (note) parts.push(note);

  return parts.length > 0 ? parts.join(" · ") : null;
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
