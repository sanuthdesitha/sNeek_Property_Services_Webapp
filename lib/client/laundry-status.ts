/**
 * How a client reads a laundry run's status. Plain module (no "use client"):
 * the Estate and classic client pages (laundry, home, property, clean pages)
 * all label and colour a status from here, so a new stored status never shows
 * as a raw code.
 *
 * READY_TO_RETURN (2026-11-13) means the linen is clean at the laundry and
 * waiting to come back: still away from the property, never "delivered".
 */

export type ClientLaundryTone = "success" | "gold" | "info" | "warning" | "danger" | "neutral";

export const CLIENT_LAUNDRY_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked up",
  READY_TO_RETURN: "Ready to come back",
  DROPPED: "Delivered",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped",
};

/** Statuses after which the run is finished for the client. READY_TO_RETURN is not one. */
export const CLIENT_LAUNDRY_FINISHED = new Set(["DROPPED", "SKIPPED_PICKUP"]);

function titleCase(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function clientLaundryStatusLabel(status: unknown): string {
  const key = String(status ?? "");
  return CLIENT_LAUNDRY_STATUS_LABELS[key] ?? titleCase(key);
}

export function clientLaundryStatusTone(status: unknown): ClientLaundryTone {
  switch (String(status ?? "")) {
    case "DROPPED":
      return "success";
    case "CONFIRMED":
      return "info";
    // Collected, or clean and waiting to come back: the linen is away ("in flight").
    case "PICKED_UP":
    case "READY_TO_RETURN":
      return "gold";
    case "FLAGGED":
      return "danger";
    case "SKIPPED_PICKUP":
      return "warning";
    default:
      return "neutral";
  }
}
