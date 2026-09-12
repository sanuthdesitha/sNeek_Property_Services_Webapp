export type HandoffConfirmation = {
  id?: string; confirmedByName?: string | null; createdAt?: string | Date | null;
  laundryReady?: boolean; notes?: string | null; bagLocation?: string | null; photoUrl?: string | null;
};

const labels: Record<string, string> = {
  PICKED_UP: "Pickup recorded", DROPPED: "Return recorded", EDIT_COMPLETED: "Completion details corrected",
  REVERT_TO_CONFIRMED: "Pickup confirmation reverted", REVERT_TO_PICKED_UP: "Return confirmation reverted",
  FAILED_PICKUP_RESCHEDULE: "Failed pickup rescheduled", FAILED_PICKUP_REQUEST: "Failed pickup approval requested",
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function photo(value: unknown) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function buildHandoffReceipts(confirmations: readonly HandoffConfirmation[]) {
  return confirmations.map((confirmation, index) => {
    let meta: Record<string, unknown> = {};
    try { meta = record(JSON.parse(confirmation.notes ?? "null")); } catch { /* legacy plain notes */ }
    const event = text(meta.event);
    const date = confirmation.createdAt ? new Date(confirmation.createdAt) : null;
    const at = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    const details: string[] = [];
    const bags = positiveCount(meta.bagCount);
    if (event === "PICKED_UP") details.push(bags === null ? "Bag count not recorded" : `${bags} bags recorded`);
    const location = text(meta.dropoffLocation) ?? text(confirmation.bagLocation);
    if (location) details.push(`Location: ${location}`);
    const reason = text(meta.reason) ?? text(meta.reasonNote) ?? text(meta.earlyDropoffReason);
    if (reason) details.push(`Reason: ${reason}`);
    if (text(meta.reasonCode)) details.push(`Reason code: ${text(meta.reasonCode)!.replace(/_/g, " ")}`);
    const note = text(meta.notes) ?? (!Object.keys(meta).length && confirmation.notes && !/^[\[{]/.test(confirmation.notes.trim()) ? text(confirmation.notes) : null);
    if (note && note !== reason) details.push(`Notes: ${note}`);
    if (event === "FAILED_PICKUP_REQUEST") {
      if (meta.requestedAction === "SKIP" || meta.requestedAction === "DELETE") details.push(`Requested: ${meta.requestedAction.toLowerCase()}`);
      if (text(meta.approvalStatus)) details.push(`Recorded approval status: ${text(meta.approvalStatus)}`);
    }
    if (event === "FAILED_PICKUP_RESCHEDULE" && typeof meta.rescheduledPickupDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(meta.rescheduledPickupDate)) details.push(`New pickup date: ${meta.rescheduledPickupDate.slice(0, 10)}`);
    if (event === "EDIT_COMPLETED") {
      const before = record(meta.before), after = record(meta.after);
      const fields: Array<[string, string]> = [["bagCount", "Bags"], ["dropoffLocation", "Return location"], ["loadWeightKg", "Weight (kg)"], ["totalPrice", "Cost (AUD)"]];
      for (const [key, label] of fields) {
        if (!Array.isArray(meta.changedFields) || !meta.changedFields.includes(key)) continue;
        const display = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? String(value) : text(value) ?? "not recorded";
        details.push(`${label}: ${display(before[key])} → ${display(after[key])}`);
      }
    }
    return {
      id: confirmation.id ?? `receipt-${index}`, at,
      actor: text(confirmation.confirmedByName) ?? "Name unavailable",
      label: event ? labels[event] ?? "Laundry event recorded" : confirmation.laundryReady === true ? "Readiness recorded: ready" : confirmation.laundryReady === false ? "Readiness recorded: not ready" : "Laundry event recorded",
      details, photoUrl: photo(confirmation.photoUrl),
    };
  }).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

export function handoffTimeLabel(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
