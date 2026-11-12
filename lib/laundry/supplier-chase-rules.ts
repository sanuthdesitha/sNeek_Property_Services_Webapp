/**
 * "Chase supplier" on a laundry run: when it is offered and the drafted
 * message. PURE (safe for client bundles).
 *
 * Offered on a run that has a supplier and EITHER the Pipeline flags
 * OVER_TURNAROUND (picked up and at the laundry beyond the supplier's average
 * turnaround, or beyond the organisation's maximum days out when the supplier
 * has none recorded), OR a laundry team request applies but the partner has no
 * linked portal users to ask (2026-11-12: the external contact is then the
 * only way to reach the partner; the draft follows that request). Sending uses the supplier's stored email / phone only; the
 * office never types an address here.
 */
import type { PipelineException } from "./pipeline";
import { isAtLaundryStatus } from "./status-groups";
import type { LaundryTeamRequestKind } from "./nudge-rules";

/** One chase per run within this many minutes (like the cleaner nudges). */
export const SUPPLIER_CHASE_COOL_DOWN_MINUTES = 30;

export type SupplierChaseTransport = "EMAIL" | "SMS";

export type SupplierChaseFacts = {
  status: string;
  hasSupplier: boolean;
  exceptions: readonly PipelineException[];
  /** The team request the run calls for when the partner has no portal users to ask; null/absent otherwise. */
  unansweredTeamRequest?: LaundryTeamRequestKind | null;
};

/** Null when "Chase supplier" applies, otherwise the reason it does not. */
export function supplierChaseBlockedReason(run: SupplierChaseFacts): string | null {
  if (!run.hasSupplier) return "No supplier is recorded for this run.";
  if (run.unansweredTeamRequest) return null;
  if (!isAtLaundryStatus(run.status)) return "The run is not at the laundry.";
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
  /** When the chase stands in for a team request (no portal users), what to ask; absent = the return date. */
  purpose?: LaundryTeamRequestKind | null;
};

const PURPOSE_ASK: Record<Exclude<LaundryTeamRequestKind, "TEAM_RETURN_ETA">, { subject: string; ask: string }> = {
  TEAM_CONFIRM_PICKUP: { subject: "please confirm the pickup", ask: "Please confirm the laundry pickup, or let us know when it will happen." },
  TEAM_MOVE_PICKUP: { subject: "can you collect later today?", ask: "The clean is running late and the bags are not out yet. Can you collect later today? Please let us know the time." },
  TEAM_CONFIRM_DROP: { subject: "please confirm the drop-off", ask: "Please confirm the laundry drop-off, or let us know when it will happen." },
  TEAM_PHOTO: { subject: "drop-off photo", ask: "Please send us the drop-off photo for this delivery." },
};

export type SupplierChaseDraft = { subject: string; body: string };

export function draftSupplierChase(input: SupplierChaseDraftInput): SupplierChaseDraft {
  const place = input.propertySuburb ? `${input.propertyName} (${input.propertySuburb})` : input.propertyName;
  const bags = input.bagCount === null ? "the bags (count not recorded)" : `${input.bagCount} bag${input.bagCount === 1 ? "" : "s"}`;
  const days = `${input.daysAtLaundry} day${input.daysAtLaundry === 1 ? "" : "s"}`;
  const usual = input.turnaroundHours ? ` Your usual turnaround is ${input.turnaroundHours} hours.` : "";
  const reply = input.officePhone?.trim() ? ` Reply to this message or call ${input.officePhone.trim()}.` : " Reply to this message.";
  if (input.purpose && input.purpose !== "TEAM_RETURN_ETA") {
    const purpose = PURPOSE_ASK[input.purpose];
    return {
      subject: `Laundry for ${input.propertyName}: ${purpose.subject}`,
      body: `Hi ${input.supplierName}, this is ${input.officeName}. About the laundry for ${place} (${bags}). ${purpose.ask}${reply}`,
    };
  }
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
