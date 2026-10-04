import { buildHandoffReceipts, handoffTimeLabel, type HandoffConfirmation } from "./handoff-receipts";
import { resolvePickupReadinessFromConfirmations } from "./pickup-readiness";

export type InvestigationTask = {
  id: string; propertyId?: string; jobId?: string; status: string;
  pickupDate: string; dropoffDate: string; createdAt?: string | null;
  confirmedAt?: string | null; pickedUpAt?: string | null; droppedAt?: string | null;
  flagReason?: string | null; flagNotes?: string | null; skipReasonNote?: string | null;
  noPickupRequired?: boolean;
  property?: { id?: string; name?: string | null } | null;
  supplier?: { name?: string | null } | null;
  confirmations?: readonly HandoffConfirmation[] | null;
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
function meta(notes?: string | null): Record<string, unknown> {
  try { const value = JSON.parse(notes ?? "null"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
export function investigationTime(value?: string | null) {
  return value && Number.isFinite(new Date(value).getTime()) ? handoffTimeLabel(value) : "Time not recorded";
}
export function investigationDate(value: string) {
  return Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString().slice(0,10) : "Date not recorded";
}
export function investigationPropertyKey(task: InvestigationTask) {
  return task.property?.id ?? task.propertyId ?? `unknown:${task.id}`;
}

/** A read-only view of recorded facts; event authors are not proof of recipient acceptance. */
export function investigateLaundry(task: InvestigationTask) {
  const rows = [...(task.confirmations ?? [])].sort((a,b) =>
    (new Date(a.createdAt ?? 0).getTime() || 0) - (new Date(b.createdAt ?? 0).getTime() || 0));
  const latest = [...rows].reverse();
  const readiness = latest.find(row => !text(meta(row.notes).event) && typeof row.laundryReady === "boolean");
  const pickup = latest.find(row => meta(row.notes).event === "PICKED_UP");
  const dropped = latest.find(row => meta(row.notes).event === "DROPPED");
  const driverReadiness = resolvePickupReadinessFromConfirmations(rows);
  const ready = task.noPickupRequired ? "No pickup required" : readiness
    ? `${readiness.laundryReady ? "Ready" : "Not ready"} — recorded by ${text(readiness.confirmedByName) ?? "name unavailable"}`
    : "Cleaner readiness not recorded";
  const issues = [text(task.flagReason)?.replace(/_/g," "), text(task.flagNotes), text(task.skipReasonNote)].filter((value): value is string => Boolean(value));
  if (task.status === "FLAGGED" && latest.some(row => { const m = meta(row.notes); return m.event === "FAILED_PICKUP_REQUEST" && m.approvalStatus === "PENDING"; })) {
    issues.push("Office approval pending for failed pickup");
  }
  if (driverReadiness === "NOT_READY") issues.push("Driver recorded linen not ready at the latest recorded pickup");
  let holder = "Current holder not confirmed by the records";
  if (task.status === "PICKED_UP" && pickup) holder = `Pickup recorded by ${text(pickup.confirmedByName) ?? "name unavailable"}; onward custody not confirmed`;
  if (task.status === "DROPPED" && dropped) {
    // A later correction is evidence too; never silently show the original location as current.
    const dropIndex = rows.indexOf(dropped);
    const correction = rows.slice(dropIndex + 1).reverse().map(row => meta(row.notes)).find(m =>
      m.event === "EDIT_COMPLETED" && Array.isArray(m.changedFields) && m.changedFields.includes("dropoffLocation"));
    const after = correction?.after as Record<string, unknown> | undefined;
    const location = correction ? text(after?.dropoffLocation) : text(meta(dropped.notes).dropoffLocation) ?? text(dropped.bagLocation);
    holder = `Return recorded${location ? ` at ${location}` : "; location not recorded"}; recipient acceptance not recorded`;
  }
  const next = task.status === "FLAGGED" ? "Office — resolve the flagged run"
    : task.status === "DROPPED" ? "Receiving team — check the recorded return; recipient not identified"
    : task.status === "SKIPPED_PICKUP" || task.noPickupRequired ? "Office — review the next linen requirement"
    : task.status === "PICKED_UP" ? `${text(task.supplier?.name) ?? "Laundry team"} — return pending; individual assignee not recorded`
    : task.status === "CONFIRMED" ? "Laundry team — pickup pending; individual assignee not recorded"
    : "Cleaner — confirm readiness; individual assignee not recorded";
  const milestones = [
    ["Task created", task.createdAt], ["Confirmed", task.confirmedAt],
    ["Picked up", task.pickedUpAt], ["Returned", task.droppedAt],
  ].filter(([,at]) => Boolean(at)).map(([label,at]) => ({ label, at: investigationTime(at) }));
  const receipts = buildHandoffReceipts(rows);
  const summary = [
    `${task.property?.name ?? "Property not recorded"} · Run ${task.id} · ${task.status.replace(/_/g," ")}`,
    `Planned pickup: ${investigationDate(task.pickupDate)}; return: ${investigationDate(task.dropoffDate)}`,
    `Readiness: ${ready}`, `Holder/location: ${holder}`, `Next responsibility: ${next}`,
    `Recorded issues: ${issues.length ? issues.join("; ") : "None recorded"}`,
    ...receipts.map(row => `${row.at ? investigationTime(row.at) : "Time not recorded"}: ${row.label} — ${row.actor}`),
  ].join("\n");
  return { ready, holder, next, issues, milestones, summary };
}
