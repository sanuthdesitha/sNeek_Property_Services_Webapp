/**
 * "Chase supplier" on a laundry run: when it is offered and the drafted
 * message. PURE (safe for client bundles).
 *
 * Offered only on a run the Pipeline already flags OVER_TURNAROUND (picked up
 * and at the laundry beyond the supplier's average turnaround, or beyond the
 * organisation's maximum days out when the supplier has none recorded) that
 * has a supplier. Sending uses the supplier's stored email / phone only; the
 * office never types an address here.
 */
import type { PipelineException } from "./pipeline";

/** One chase per run within this many minutes (like the cleaner nudges). */
export const SUPPLIER_CHASE_COOL_DOWN_MINUTES = 30;

export type SupplierChaseTransport = "EMAIL" | "SMS";

export type SupplierChaseFacts = {
  status: string;
  hasSupplier: boolean;
  exceptions: readonly PipelineException[];
};

/** Null when "Chase supplier" applies, otherwise the reason it does not. */
export function supplierChaseBlockedReason(run: SupplierChaseFacts): string | null {
  if (!run.hasSupplier) return "No supplier is recorded for this run.";
  if (run.status !== "PICKED_UP") return "The run is not at the laundry.";
  if (!run.exceptions.some((item) => item.code === "OVER_TURNAROUND")) return "The run is still within the supplier's turnaround.";
  return null;
}

export function supplierChaseApplies(run: SupplierChaseFacts): boolean {
  return supplierChaseBlockedReason(run) === null;
}

export type SupplierChaseDraftInput = {
  supplierName: string;
  propertyName: string;
  propertySuburb: string | null;
  bagCount: number | null;
  /** Calendar days at the laundry (organisation day boundaries). */
  daysAtLaundry: number;
  pickedUpLabel: string;
  turnaroundHours: number | null;
  officeName: string;
  officePhone: string | null;
};

export type SupplierChaseDraft = { subject: string; body: string };

export function draftSupplierChase(input: SupplierChaseDraftInput): SupplierChaseDraft {
  const place = input.propertySuburb ? `${input.propertyName} (${input.propertySuburb})` : input.propertyName;
  const bags = input.bagCount === null ? "the bags (count not recorded)" : `${input.bagCount} bag${input.bagCount === 1 ? "" : "s"}`;
  const days = `${input.daysAtLaundry} day${input.daysAtLaundry === 1 ? "" : "s"}`;
  const usual = input.turnaroundHours ? ` Your usual turnaround is ${input.turnaroundHours} hours.` : "";
  const reply = input.officePhone?.trim() ? ` Reply to this message or call ${input.officePhone.trim()}.` : " Reply to this message.";
  return {
    subject: `Laundry for ${input.propertyName}: ready date?`,
    body: `Hi ${input.supplierName}, this is ${input.officeName}. We are checking on the laundry for ${place}: ${bags}, picked up ${input.pickedUpLabel}, now ${days} with you.${usual} Please let us know when it will be ready for delivery.${reply}`,
  };
}

export function supplierMailtoHref(email: string | null, draft: SupplierChaseDraft): string | null {
  if (!email) return null;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

export function supplierTelHref(phone: string | null): string | null {
  if (!phone) return null;
  const compact = phone.replace(/[^0-9+]/g, "");
  return compact ? `tel:${compact}` : null;
}

/**
 * The chase key for a run and cool-down window, so a double click or a retry
 * after "no answer" is one request and the server's cool-down answers the rest.
 */
export function supplierChaseKey(taskId: string, nowMs: number): string {
  const windowIndex = Math.floor(nowMs / (SUPPLIER_CHASE_COOL_DOWN_MINUTES * 60_000));
  return `chase:${taskId}:${windowIndex}`.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 70);
}
