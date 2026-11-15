"use client";

/**
 * "Move or reassign…" from 640px up (board "Everyday dialogs and sheets",
 * 2026-11): one window instead of a form followed by a second confirmation.
 *
 *   Date, Time, Cleaner, "Instead of" (a current cleaner, or Keep both) →
 *   "Check move" runs the same server check a drop runs
 *   (`/api/admin/calendar/check-move` through the page's `useCalendarMove`) →
 *   the answer shows here, with "Tell the client?" (owner default: yes for a
 *   date or time change, no for a cleaner swap) → the button names the result
 *   ("Move to Fri 13 Nov 11:00") and saves through the same reschedule /
 *   assign calls.
 *
 * Changing the draft after a check discards that check, so the button can only
 * save what the server checked. A failed save keeps the window, the draft and
 * the answer. The dialog is keyed by job, so another job starts a fresh draft.
 */
import { useEffect, useRef, useState } from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EChoiceChips, EFacts, EFactRow, preventEnterSubmit } from "@/components/v2/ui/form-dialog-parts";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { isDayKey, mediumDayLabel } from "@/lib/calendar/range";
import type { CalendarJob, CalendarRow } from "@/lib/calendar/types";
import { ClientNoticeChoice, useTellClient } from "./client-notice-choice";
import { MoveCheckBody, moveActionLabel, moveQuestion } from "./calendar-move-confirm";
import type { MoveRequest, MoveState } from "./use-calendar-move";

export type MoveDialogTarget = { job: CalendarJob; sourceCleanerId: string | null };
export type MoveDialogResult = { toDate: string; fromCleanerId: string | null; toCleanerId: string | null; toStartTime?: string };

type DialogProps = {
  target: MoveDialogTarget;
  cleaners: CalendarRow[];
  moveState: MoveState;
  /** Runs the server check (the page's `useCalendarMove().request`). */
  onCheck: (draft: MoveDialogResult) => void;
  /** Saves the checked move with the "Tell the client?" answer. */
  onSave: (tellClient?: boolean) => void;
  /** Discards a check that no longer matches the draft. */
  onDiscardCheck: () => void;
  onClose: () => void;
};

/** "" in the Instead-of choice means Keep both (nobody is replaced). */
const KEEP_BOTH = "";

function defaultReplace(target: MoveDialogTarget): string {
  const { job, sourceCleanerId } = target;
  if (sourceCleanerId && job.cleaners.some((cleaner) => cleaner.id === sourceCleanerId)) return sourceCleanerId;
  return job.cleaners.find((cleaner) => cleaner.isPrimary)?.id ?? job.cleaners[0]?.id ?? KEEP_BOTH;
}

/** Two requests ask the same of the server. */
function sameRequest(request: MoveRequest, draft: MoveDialogResult, jobId: string): boolean {
  return request.job.id === jobId
    && request.toDate === draft.toDate
    && (request.toCleanerId ?? null) === draft.toCleanerId
    && (request.fromCleanerId ?? null) === draft.fromCleanerId
    && (request.toStartTime ?? null) === (draft.toStartTime ?? null);
}

export function CalendarMoveDialog({ target, cleaners, moveState, onCheck, onSave, onDiscardCheck, onClose }: DialogProps) {
  const { job } = target;
  const [date, setDate] = useState(job.day);
  const [start, setStart] = useState(job.startTime ?? "");
  const [toCleanerId, setToCleanerId] = useState("");
  const [replaceId, setReplaceId] = useState(() => defaultReplace(target));
  const choices = cleaners.filter((cleaner) => cleaner.active && !job.cleaners.some((current) => current.id === cleaner.id));
  const validDate = isDayKey(date);
  const validStart = start === "" || /^\d{2}:\d{2}$/.test(start);
  const timeChanged = start !== "" && start !== (job.startTime ?? "");
  const unchanged = date === job.day && !toCleanerId && !timeChanged;
  const draft: MoveDialogResult = {
    toDate: date,
    toCleanerId: toCleanerId || null,
    fromCleanerId: toCleanerId && job.cleaners.length > 0 ? replaceId || null : null,
    ...(timeChanged ? { toStartTime: start } : {}),
  };

  const phase = moveState.phase;
  const forThisDraft = phase !== "idle" && sameRequest(moveState.request, draft, job.id);
  const checking = phase === "checking";
  const saving = phase === "saving";
  const busy = checking || saving;
  const checked = forThisDraft && phase === "confirm";
  const check = forThisDraft && (phase === "confirm" || phase === "saving") ? moveState.check : null;
  const tell = useTellClient(job, check);

  // A check that no longer matches the draft is discarded.
  const discard = useRef(onDiscardCheck);
  discard.current = onDiscardCheck;
  const stale = moveState.phase !== "idle" && moveState.phase !== "done" && !busy && !forThisDraft && moveState.request.job.id === job.id;
  useEffect(() => {
    if (stale) discard.current();
  }, [stale]);

  function primary(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (checked) onSave(tell.answer);
    else if (validDate && validStart && !unchanged) onCheck(draft);
  }

  const replaceOptions = [
    ...job.cleaners.map((cleaner) => ({ value: cleaner.id, label: cleaner.name })),
    { value: KEEP_BOTH, label: "Keep both" },
  ];
  const now = `${mediumDayLabel(job.day)}${job.startTime ? ` ${job.startTime}` : ""} with ${job.cleaners.map((cleaner) => cleaner.name).join(", ") || "no cleaner"}`;
  const primaryLabel = saving ? "Moving…" : checking ? "Checking…" : check && checked ? moveActionLabel(check) : "Check move";

  return (
    <EActionDialog
      open
      layout="form"
      eyebrow={`${job.jobNumber} · ${job.propertyName}`}
      title="Move or reassign"
      phoneTitle={`Move · ${job.propertyName}`}
      busy={busy}
      onClose={onClose}
      footerNote={phase === "failed" && forThisDraft ? "Your choices are kept." : undefined}
      footer={(
        <>
          <EButton type="button" variant="outline" size="sm" className="max-sm:hidden" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton type="button" size="sm" onClick={() => primary()} disabled={busy || (!checked && (!validDate || !validStart || unchanged))}>{primaryLabel}</EButton>
        </>
      )}
    >
      <form className="space-y-3" onSubmit={primary} onKeyDown={preventEnterSubmit}>
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
            <EField label="Date">
              <EInput type="date" value={date} onChange={(event) => setDate(event.target.value)} required className="max-sm:h-11 max-sm:text-[1rem]" />
            </EField>
            <EField label="Time">
              <EInput type="time" step={900} value={start} onChange={(event) => setStart(event.target.value)} className="max-sm:h-11 max-sm:text-[1rem]" />
            </EField>
          </div>
          <EField label="Cleaner">
            <ESelect value={toCleanerId} onChange={(event) => setToCleanerId(event.target.value)} className="max-sm:h-11 max-sm:text-[1rem]">
              <option value="">{job.cleaners.length === 0 ? "Leave unassigned" : "Keep the current cleaners"}</option>
              {choices.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.label}</option>)}
            </ESelect>
          </EField>
          {toCleanerId && job.cleaners.length > 0 ? (
            <EChoiceChips label="Instead of" name={`move-replace-${job.id}`} value={replaceId} options={replaceOptions} onChange={setReplaceId} disabled={busy} />
          ) : null}
        </fieldset>
        {!validDate ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-band-problem-fg))]">Choose a date.</p> : null}
        {!validStart ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-band-problem-fg))]">Choose a time, or leave it as it is.</p> : null}

        <EFacts label="Before you move it">
          <EFactRow label="Now" value={now} />
          {job.guestArrival ? <EFactRow label="Guest in" value={job.guestArrival.time ?? "Time not given"} /> : null}
          <div aria-live="polite" className="space-y-1.5 pt-1">
            {check ? <p className="font-[600]">{moveQuestion(check)}</p> : null}
            {forThisDraft ? <MoveCheckBody state={moveState} clientChoiceShown={tell.shown} /> : (
              <p className="text-[hsl(var(--e-text-secondary))]">
                {unchanged ? "Change the date, time or cleaner." : "Check move asks the server for clashes, leave and roster gaps. Nothing is saved until you press the move button."}
              </p>
            )}
          </div>
        </EFacts>

        {tell.scope && check ? (
          <ClientNoticeChoice job={job} scope={tell.scope} value={tell.value} onChange={tell.setValue} disabled={busy} />
        ) : null}
      </form>
    </EActionDialog>
  );
}
