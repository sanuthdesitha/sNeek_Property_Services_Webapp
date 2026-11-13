/**
 * Event names and pure readers for the office's run corrections (Change
 * state, Void, Undo void) recorded as LaundryConfirmation rows. PLAIN module.
 */
export const OFFICE_CORRECTION_EVENT = "OFFICE_CORRECTION";
export const RUN_VOIDED_EVENT = "RUN_VOIDED";
export const RUN_VOID_UNDONE_EVENT = "RUN_VOID_UNDONE";
export const TEAM_RECORD_AFTER_CORRECTION_EVENT = "TEAM_RECORD_AFTER_OFFICE_CORRECTION";
export const FAILED_PICKUP_VOIDED_EVENT = "FAILED_PICKUP_REQUEST_VOIDED";

export function parseCorrectionNotes(notes: string | null | undefined): Record<string, unknown> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type ConfirmationRow = { notes: string | null; laundryReady: boolean; createdAt: Date };

/** The cleaner's latest "ready" handoff (a row with no event). */
export function cleanerHandoffAt(confirmations: readonly ConfirmationRow[]): Date | null {
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const row = confirmations[index];
    const event = parseCorrectionNotes(row.notes).event;
    if ((event === undefined || event === null || event === "") && row.laundryReady === true) return row.createdAt;
  }
  return null;
}

export function hasFailedPickup(confirmations: readonly ConfirmationRow[]): boolean {
  return confirmations.some((row) => {
    const event = String(parseCorrectionNotes(row.notes).event ?? "");
    return event === "FAILED_PICKUP_RESCHEDULE" || event === "FAILED_PICKUP_REQUEST";
  });
}

/** A failed-pickup request still waiting for a decision (the approve route's own test). */
export function pendingFailedPickupRequest<T extends { notes: string | null }>(confirmations: readonly T[]): T | null {
  const decided = new Set(["FAILED_PICKUP_SKIP_APPROVED", "FAILED_PICKUP_REQUEST_REJECTED"]);
  // Undo void reopens the request the void closed.
  let reopened = false;
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const meta = parseCorrectionNotes(confirmations[index].notes);
    const event = String(meta.event ?? "");
    if (event === RUN_VOID_UNDONE_EVENT) { reopened = true; continue; }
    if (event === FAILED_PICKUP_VOIDED_EVENT) {
      if (reopened) { reopened = false; continue; }
      return null;
    }
    if (decided.has(event)) return null;
    if (meta.event === "FAILED_PICKUP_REQUEST" && meta.approvalStatus === "PENDING") return confirmations[index];
  }
  return null;
}

