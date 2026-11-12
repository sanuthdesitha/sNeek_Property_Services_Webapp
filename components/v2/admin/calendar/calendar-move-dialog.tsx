"use client";

/**
 * "Move or reassign…": the keyboard (and touch) way to do what a drag does.
 * Pick a date and, optionally, a cleaner; "Check move" runs the same server
 * check and confirmation as a drop. The dialog is keyed by job, so its draft
 * resets when a different job is opened.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import { isDayKey } from "@/lib/calendar/range";
import type { CalendarJob, CalendarRow } from "@/lib/calendar/types";

export type MoveDialogTarget = { job: CalendarJob; sourceCleanerId: string | null };
export type MoveDialogResult = { toDate: string; fromCleanerId: string | null; toCleanerId: string | null };

type DialogProps = {
  target: MoveDialogTarget;
  cleaners: CalendarRow[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (result: MoveDialogResult) => void;
};

function defaultReplace(target: MoveDialogTarget): string {
  const { job, sourceCleanerId } = target;
  if (sourceCleanerId && job.cleaners.some((cleaner) => cleaner.id === sourceCleanerId)) return sourceCleanerId;
  return job.cleaners.find((cleaner) => cleaner.isPrimary)?.id ?? job.cleaners[0]?.id ?? "";
}

export function CalendarMoveDialog({ target, cleaners, busy, onClose, onSubmit }: DialogProps) {
  const { job } = target;
  const [date, setDate] = useState(job.day);
  const [toCleanerId, setToCleanerId] = useState("");
  const [replaceId, setReplaceId] = useState(() => defaultReplace(target));
  const choices = cleaners.filter((cleaner) => cleaner.active && !job.cleaners.some((current) => current.id === cleaner.id));
  const validDate = isDayKey(date);
  const unchanged = date === job.day && !toCleanerId;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validDate || unchanged || busy) return;
    onSubmit({
      toDate: date,
      toCleanerId: toCleanerId || null,
      fromCleanerId: toCleanerId && job.cleaners.length > 0 ? replaceId || null : null,
    });
  }

  return (
    <EModal open onClose={busy ? () => undefined : onClose} title="Move or reassign" eyebrow={job.propertyName}>
      <form className="space-y-4" onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-4">
          <EField label="Date">
            <EInput type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </EField>
          <EField label="Cleaner" hint={job.cleaners.length === 0 ? "Nobody is on this job yet." : `Now: ${job.cleaners.map((cleaner) => cleaner.name).join(", ")}`}>
            <ESelect value={toCleanerId} onChange={(event) => setToCleanerId(event.target.value)}>
              <option value="">{job.cleaners.length === 0 ? "Leave unassigned" : "Keep the current cleaners"}</option>
              {choices.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.label}</option>)}
            </ESelect>
          </EField>
          {toCleanerId && job.cleaners.length > 1 ? (
            <EField label="Instead of">
              <ESelect value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
                {job.cleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}{cleaner.isPrimary ? " (primary)" : ""}</option>)}
              </ESelect>
            </EField>
          ) : null}
        </fieldset>
        {!validDate ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Choose a date.</p> : null}
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton type="submit" disabled={busy || !validDate || unchanged}>{busy ? "Checking…" : "Check move"}</EButton>
        </div>
      </form>
    </EModal>
  );
}
