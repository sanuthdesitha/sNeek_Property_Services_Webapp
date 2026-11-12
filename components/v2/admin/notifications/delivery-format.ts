import type { EPillTone } from "@/components/v2/ui/pill";
import type { DeliveryState } from "@/lib/notifications/delivery-log-map";

/** Shown in the browser's locale; the server always returns ISO instants. */
export function formatDeliveryTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) });
}

export function stateTone(state: DeliveryState): EPillTone {
  if (state === "failed" || state === "bounced") return "bad";
  if (state === "uncertain" || state === "retry_wait") return "warn";
  if (state === "delivered" || state === "opened" || state === "inbox_available" || state === "provider_accepted") return "ok";
  if (state === "skipped") return "neutral";
  return "info";
}
