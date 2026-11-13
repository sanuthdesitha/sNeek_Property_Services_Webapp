"use client";

/**
 * Phones only (below 640px): "Move or reassign" as a bottom sheet, because
 * dragging is not usable on a phone (board "Admin phone: Calendar", 2026-11).
 *
 * Day, start time and cleaner (each cleaner flagged Free, Clash, Leave or Not
 * rostered from the calendar already loaded) build the SAME move request a
 * drop builds. "Check move" sends it to `/api/admin/calendar/check-move`
 * through the page's `useCalendarMove`; the server's answer is shown here in
 * the confirmation's own words (`MoveCheckBody`), and "Save move" is that
 * hook's `confirm`, i.e. the same reschedule / assign calls a drop makes.
 * Changing the draft after a check discards the check. A refused move says
 * nothing was changed. "Assign QA inspector" opens the calendar's QA dialog.
 *
 * Keyed by job in the page, so the draft resets when another job is opened.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { formatHours } from "@/lib/calendar/presentation";
import { isDayKey, mediumDayLabel } from "@/lib/calendar/range";
import type { CalendarResponse, CalendarRow } from "@/lib/calendar/types";
import { CLEANER_FLAG_LABEL, cleanerFlag, type CleanerFlag } from "./calendar-phone-model";
import { MoveCheckBody, moveQuestion } from "./calendar-move-confirm";
import type { MoveDialogTarget } from "./calendar-move-dialog";
import type { MoveRequest, MoveState } from "./use-calendar-move";

export type MoveSheetDraft = { toDate: string; fromCleanerId: string | null; toCleanerId: string | null; toStartTime?: string };

type MoveSheetProps = {
  target: MoveDialogTarget;
  data: CalendarResponse | null;
  cleaners: CalendarRow[];
  moveState: MoveState;
  /** Runs the server check (the page's `useCalendarMove().request`). */
  onCheck: (draft: MoveSheetDraft) => void;
  /** Saves the checked move (the page's `useCalendarMove().confirm`). */
  onSave: () => void;
  /** Discards a check that no longer matches the draft. */
  onDiscardCheck: () => void;
  onClose: () => void;
  onAssignQa: () => void;
  readOnly: boolean;
};

function defaultReplace(target: MoveDialogTarget): string {
  const { job, sourceCleanerId } = target;
  if (sourceCleanerId && job.cleaners.some((cleaner) => cleaner.id === sourceCleanerId)) return sourceCleanerId;
  return job.cleaners.find((cleaner) => cleaner.isPrimary)?.id ?? job.cleaners[0]?.id ?? "";
}

/** Two requests ask the same of the server. */
function sameRequest(request: MoveRequest, draft: MoveSheetDraft, jobId: string): boolean {
  return request.job.id === jobId
    && request.toDate === draft.toDate
    && (request.toCleanerId ?? null) === draft.toCleanerId
    && (request.fromCleanerId ?? null) === draft.fromCleanerId
    && (request.toStartTime ?? null) === (draft.toStartTime ?? null);
}

const FLAG_CLASS: Record<CleanerFlag["kind"], string> = {
  unknown: "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-secondary))]",
  free: "bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]",
  clash: "bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]",
  roster: "bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]",
  leave: "bg-[hsl(var(--e-danger-soft))] text-[hsl(var(--e-danger))]",
};

type CleanerChoiceProps = {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
  flag: CleanerFlag | null;
};

function CleanerChoice({ name, value, checked, onChange, title, detail, flag }: CleanerChoiceProps) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5",
        checked ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-[600] [overflow-wrap:anywhere]">{title}</span>
        <span className="block text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{detail}</span>
      </span>
      {flag ? (
        <span className={cn("inline-flex h-6 shrink-0 items-center rounded-[var(--e-radius-pill)] px-2 text-[0.6875rem] font-[600]", FLAG_CLASS[flag.kind])}>
          {CLEANER_FLAG_LABEL[flag.kind]}
        </span>
      ) : null}
    </label>
  );
}

export function CalendarMoveSheet(props: MoveSheetProps) {
  const { target, data, cleaners, moveState, readOnly } = props;
  const { job } = target;
  const [date, setDate] = useState(job.day);
  const [start, setStart] = useState(job.startTime ?? "");
  const [toCleanerId, setToCleanerId] = useState("");
  const [replaceId, setReplaceId] = useState(() => defaultReplace(target));

  const choices = cleaners.filter((cleaner) => cleaner.active && !job.cleaners.some((current) => current.id === cleaner.id));
  const validDate = isDayKey(date);
  const validStart = start === "" || /^\d{2}:\d{2}$/.test(start);
  const timeChanged = start !== "" && start !== (job.startTime ?? "");
  const draft: MoveSheetDraft = {
    toDate: date,
    toCleanerId: toCleanerId || null,
    fromCleanerId: toCleanerId && job.cleaners.length > 0 ? replaceId || null : null,
    ...(timeChanged ? { toStartTime: start } : {}),
  };
  const unchanged = date === job.day && !toCleanerId && !timeChanged;

  const phase = moveState.phase;
  const forThisDraft = phase !== "idle" && sameRequest(moveState.request, draft, job.id);
  const checking = phase === "checking";
  const saving = phase === "saving";
  const busy = checking || saving;
  const checked = forThisDraft && phase === "confirm";

  // A check that no longer matches the draft is discarded, so "Save move"
  // can only ever save what the server checked.
  const discard = useRef(props.onDiscardCheck);
  discard.current = props.onDiscardCheck;
  const stale = phase !== "idle" && phase !== "done" && !busy && !forThisDraft;
  useEffect(() => {
    if (stale) discard.current();
  }, [stale]);

  const currentNames = job.cleaners.map((cleaner) => cleaner.name).join(", ");
  const keepTitle = job.cleaners.length === 0 ? "No cleaner" : "Keep the current cleaners";
  const keepDetail = job.cleaners.length === 0 ? "Keep in the Unassigned lane" : `Now: ${currentNames}`;
  const startForFlags = timeChanged ? start : job.startTime;

  function primary() {
    if (checked) props.onSave();
    else if (validDate && validStart && !unchanged && !busy) props.onCheck(draft);
  }

  const primaryLabel = saving ? "Saving…" : checking ? "Checking…" : checked ? "Save move" : "Check move";
  const summary = forThisDraft && (phase === "confirm" || phase === "saving") ? moveQuestion(moveState.check) : null;

  return (
    <EBottomSheet
      open
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      busy={busy}
      title="Move or reassign"
      description={`${job.propertyName} · ${job.jobNumber}`}
      footer={(
        <>
          <EButton type="button" variant="outline" className="flex-1" onClick={props.onAssignQa} disabled={busy || readOnly}>
            {job.qa?.assignedToId ? "Reassign QA inspector" : "Assign QA inspector"}
          </EButton>
          <EButton type="button" className="flex-1" onClick={primary} disabled={busy || (!checked && (!validDate || !validStart || unchanged))}>
            {primaryLabel}
          </EButton>
        </>
      )}
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); primary(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <EField label="Day">
              <EInput type="date" value={date} onChange={(event) => setDate(event.target.value)} required className="h-11 text-[1rem]" />
            </EField>
            <EField label="Start">
              <EInput type="time" step={900} value={start} onChange={(event) => setStart(event.target.value)} className="h-11 text-[1rem]" />
            </EField>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Cleaner</legend>
            <CleanerChoice name="move-sheet-cleaner" value="" checked={toCleanerId === ""} onChange={() => setToCleanerId("")} title={keepTitle} detail={keepDetail} flag={null} />
            {choices.map((row) => {
              const flag = validDate ? cleanerFlag(data, row, job, date, startForFlags) : null;
              const detail = [flag?.text, `${formatHours(row.hours)} in the week shown`].filter(Boolean).join(" · ");
              return (
                <CleanerChoice key={row.id} name="move-sheet-cleaner" value={row.id} checked={toCleanerId === row.id} onChange={() => setToCleanerId(row.id)} title={row.label} detail={detail} flag={flag} />
              );
            })}
            {choices.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No other active cleaner is on the calendar for this range.</p> : null}
          </fieldset>
          {toCleanerId && job.cleaners.length > 1 ? (
            <EField label="Instead of">
              <ESelect value={replaceId} onChange={(event) => setReplaceId(event.target.value)} className="h-11 text-[1rem]">
                {job.cleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}{cleaner.isPrimary ? " (primary)" : ""}</option>)}
              </ESelect>
            </EField>
          ) : null}
        </fieldset>
        {!validDate ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Choose a date.</p> : null}
        {!validStart ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Choose a start time, or leave it as it is.</p> : null}

        <section aria-label="Check before saving" aria-live="polite" className="space-y-2 rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
          <p className="text-[0.8125rem] font-[650]">Check before saving</p>
          {summary ? <p className="text-[0.875rem] font-[600]">{summary}</p> : null}
          {forThisDraft ? <MoveCheckBody state={moveState} /> : (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {unchanged
                ? `Now: ${mediumDayLabel(job.day)}${job.startTime ? ` ${job.startTime}` : ""} with ${currentNames || "no cleaner"}. Change the day, start or cleaner.`
                : "Check move asks the server for clashes, leave and roster gaps. Nothing is saved until you press Save move."}
            </p>
          )}
        </section>
      </form>
    </EBottomSheet>
  );
}
