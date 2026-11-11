"use client";

/**
 * The confirmation every move goes through: "Move Bondi Studio to Fri 13 Nov,
 * Jane C.?" with what the server check found (clashes, roster, booking,
 * notices). Refusals and failures stay on screen with the server's words until
 * dismissed; the chip was never moved, so nothing needs restoring.
 */
import { EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { mediumDayLabel } from "@/lib/calendar/range";
import type { CheckMoveResponse, MoveWarning } from "@/lib/calendar/types";
import type { MoveState } from "./use-calendar-move";

const WARNING_PREFIX: Record<MoveWarning["kind"], string> = {
  clash: "Clash",
  unavailable: "Roster",
  booking: "Booking",
  notice: "Note",
};

export function moveQuestion(check: CheckMoveResponse): string {
  const dateChanges = check.toDate !== check.fromDate;
  if (check.time) {
    const when = `${mediumDayLabel(check.toDate)} at ${check.time.toStart}`;
    return check.toCleanerName ? `Move ${check.propertyName} to ${when}, ${check.toCleanerName}?` : `Move ${check.propertyName} to ${when}?`;
  }
  if (dateChanges && check.toCleanerName) return `Move ${check.propertyName} to ${mediumDayLabel(check.toDate)}, ${check.toCleanerName}?`;
  if (dateChanges) return `Move ${check.propertyName} to ${mediumDayLabel(check.toDate)}?`;
  return `Give ${check.propertyName} on ${mediumDayLabel(check.toDate)} to ${check.toCleanerName ?? "the chosen cleaner"}?`;
}

export function CalendarMoveConfirm({ state, onConfirm, onClose }: { state: MoveState; onConfirm: () => void; onClose: () => void }) {
  if (state.phase === "idle" || state.phase === "done") return null;
  const name = state.request.job.propertyName;
  const saving = state.phase === "saving";
  const check = state.phase === "confirm" || state.phase === "saving" ? state.check : state.phase === "failed" ? state.check : null;

  return (
    <EModal open onClose={saving ? () => undefined : onClose} title={check ? moveQuestion(check) : `Move ${name}`} eyebrow="Calendar move">
      <div className="space-y-4" aria-live="polite">
        {state.phase === "checking" ? <p role="status" className="text-[0.875rem]">Checking the move with the server…</p> : null}

        {state.phase === "refused" ? (
          <div role="alert" className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger-soft))] p-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            <p className="font-[600]">This move cannot be made. Nothing was changed.</p>
            {state.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          </div>
        ) : null}

        {state.phase === "failed" ? (
          <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger-soft))] p-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {state.message}
          </p>
        ) : null}

        {check?.time && state.phase !== "failed" ? (
          <p className="e-tnum text-[0.8125rem]">
            Time: {check.time.fromStart ?? "not set"}{check.time.fromDue ? `–${check.time.fromDue}` : ""} → {check.time.toStart}{check.time.toDue ? `–${check.time.toDue}` : ""} (the job keeps its length).
          </p>
        ) : null}

        {check && state.phase !== "failed" ? (
          check.warnings.length > 0 ? (
            <ul className="space-y-1.5 text-[0.8125rem]">
              {check.warnings.map((warning) => (
                <li key={`${warning.kind}:${warning.text}`} className={warning.kind === "clash" || warning.kind === "unavailable" ? "text-[hsl(var(--e-warning))]" : "text-[hsl(var(--e-text-secondary))]"}>
                  <span className="font-[600]">{WARNING_PREFIX[warning.kind]}:</span> {warning.text}
                </li>
              ))}
            </ul>
          ) : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No clashes or roster gaps found.</p>
        ) : null}

        {saving ? <p role="status" className="text-[0.8125rem]">Saving… the job stays where it is until the server answers.</p> : null}

        <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          {state.phase === "confirm" || saving ? (
            <>
              <EButton variant="outline" onClick={onClose} disabled={saving}>Cancel</EButton>
              <EButton onClick={onConfirm} disabled={saving}>{saving ? "Saving…" : "Confirm move"}</EButton>
            </>
          ) : (
            <EButton variant="outline" onClick={onClose} disabled={state.phase === "checking"}>Close</EButton>
          )}
        </div>
      </div>
    </EModal>
  );
}
