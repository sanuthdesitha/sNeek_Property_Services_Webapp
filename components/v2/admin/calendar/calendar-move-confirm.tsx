"use client";

/**
 * The confirmation a drag goes through: "Move Bondi Studio to Fri 13 Nov,
 * Jane C.?" with what the server check found (clashes, roster, booking), and
 * "Tell the client?" in the same window (board "Everyday dialogs and sheets",
 * 2026-11). Refusals and failures stay on screen with the server's words until
 * dismissed; the chip was never moved, so nothing needs restoring.
 */
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ClientNoticeChoice, useTellClient } from "./client-notice-choice";
import { mediumDayLabel } from "@/lib/calendar/range";
import type { CheckMoveResponse, MoveWarning } from "@/lib/calendar/types";
import type { MoveState } from "./use-calendar-move";

const WARNING_PREFIX: Record<MoveWarning["kind"], string> = {
  clash: "Clash",
  unavailable: "Roster",
  leave: "Leave",
  document: "Document",
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

/** The confirm button names the result: "Move to Fri 13 Nov 11:00" or "Give to Aiko T.". */
export function moveActionLabel(check: CheckMoveResponse): string {
  if (check.plan.reschedule) return `Move to ${mediumDayLabel(check.toDate)}${check.time ? ` ${check.time.toStart}` : ""}`;
  return `Give to ${check.toCleanerName ?? "the chosen cleaner"}`;
}

/**
 * What the server check said, in the confirmation's words: checking, refusal,
 * failure, the time change, the warnings and the saving note. Shared by the
 * confirmation dialog and the phone "Move or reassign" sheet.
 */
export function MoveCheckBody({ state, clientChoiceShown = false }: { state: MoveState; clientChoiceShown?: boolean }) {
  if (state.phase === "idle" || state.phase === "done") return null;
  const saving = state.phase === "saving";
  const check = state.phase === "confirm" || state.phase === "saving" ? state.check : state.phase === "failed" ? state.check : null;
  return (
    <>
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
          Time: {check.time.fromStart ?? "not set"}{(check.time.fromEnd ?? check.time.fromDue) ? `–${check.time.fromEnd ?? check.time.fromDue}` : ""} → {check.time.toStart}{(check.time.toEnd ?? check.time.toDue) ? `–${check.time.toEnd ?? check.time.toDue}` : ""} (the job keeps its length{check.time.toEnd ? "; start and end move together" : ""}).
        </p>
      ) : null}

      {check && state.phase !== "failed" ? (
        shownWarnings(check, clientChoiceShown).length > 0 ? (
          <ul className="space-y-1.5 text-[0.8125rem]">
            {shownWarnings(check, clientChoiceShown).map((warning) => (
              <li key={`${warning.kind}:${warning.text}`} className={warning.kind === "clash" || warning.kind === "unavailable" || warning.kind === "leave" || warning.kind === "document" ? "text-[hsl(var(--e-warning))]" : "text-[hsl(var(--e-text-secondary))]"}>
                <span className="font-[600]">{WARNING_PREFIX[warning.kind]}:</span> {warning.text}
              </li>
            ))}
          </ul>
        ) : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No clashes or roster gaps found.</p>
      ) : null}

      {saving ? <p role="status" className="text-[0.8125rem]">Saving… the job stays where it is until the server answers.</p> : null}
    </>
  );
}

/**
 * With "Tell the client?" in the window, the server's notice lines about
 * client emails would contradict the choice; they are replaced by one line
 * about the cleaners' usual notices.
 */
function shownWarnings(check: CheckMoveResponse, clientChoiceShown: boolean): MoveWarning[] {
  if (!clientChoiceShown) return check.warnings;
  const others = check.warnings.filter((warning) => warning.kind !== "notice");
  const hadNotice = others.length !== check.warnings.length;
  return hadNotice ? [...others, { kind: "notice", text: "Assigned cleaners are told by the usual notices." }] : others;
}

/** The confirmation after a drag on the calendar; "Move or reassign…" does all of this in its own window. */
export function CalendarMoveConfirm({ state, onConfirm, onClose }: { state: MoveState; onConfirm: (tellClient?: boolean) => void; onClose: () => void }) {
  if (state.phase === "idle" || state.phase === "done") return null;
  return <MoveConfirmWindow state={state} onConfirm={onConfirm} onClose={onClose} />;
}

function MoveConfirmWindow({ state, onConfirm, onClose }: { state: Exclude<MoveState, { phase: "idle" } | { phase: "done" }>; onConfirm: (tellClient?: boolean) => void; onClose: () => void }) {
  const job = state.request.job;
  const saving = state.phase === "saving";
  const check = state.phase === "confirm" || state.phase === "saving" ? state.check : state.phase === "failed" ? state.check : null;
  const tell = useTellClient(job, state.phase === "confirm" || saving ? check : null);

  return (
    <EActionDialog
      open
      layout="form"
      eyebrow={`${job.jobNumber} · ${job.propertyName}`}
      title={check ? moveQuestion(check) : `Move ${job.propertyName}`}
      busy={saving}
      onClose={onClose}
      footerNote={state.phase === "failed" ? "Nothing more was changed. Close and check the calendar." : undefined}
      footer={state.phase === "confirm" || saving ? (
        <>
          <EButton variant="outline" size="sm" className="max-sm:hidden" onClick={onClose} disabled={saving}>Cancel</EButton>
          <EButton size="sm" onClick={() => onConfirm(tell.answer)} disabled={saving}>{saving ? "Moving…" : check ? moveActionLabel(check) : "Confirm move"}</EButton>
        </>
      ) : (
        <EButton variant="outline" size="sm" onClick={onClose} disabled={state.phase === "checking"}>Close</EButton>
      )}
    >
      <div className="space-y-3" aria-live="polite">
        <MoveCheckBody state={state} clientChoiceShown={tell.shown} />
        {tell.scope && (state.phase === "confirm" || saving) ? (
          <ClientNoticeChoice job={job} scope={tell.scope} value={tell.value} onChange={tell.setValue} disabled={saving} />
        ) : null}
      </div>
    </EActionDialog>
  );
}
