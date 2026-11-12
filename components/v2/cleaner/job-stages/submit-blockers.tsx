"use client";

/**
 * "Before you submit" (board state C): only what stops the submit, each one a
 * jump link to the place it is fixed. Items still on this phone are listed
 * apart from what the server has, and they are not links because there is
 * nothing to fix on the form — they send, or need an explicit removal.
 *
 * The checks themselves are computed by the stage from the workspace's own
 * validation; this component only lays them out.
 */
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import * as React from "react";
import { AlertTriangle, ChevronRight, CheckCircle2, CloudOff } from "lucide-react";
import { stripHtmlToText } from "@/lib/forms/sanitize";

export interface FormBlocker {
  fieldId: string;
  label: string;
  sectionLabel?: string | null;
}

export interface SubmitBlockersProps {
  /** Device and sync blockers (uploads still on this phone, unused attachments, form contract). */
  syncBlockers: string[];
  tasksPending: boolean;
  formErrors: FormBlocker[];
  laundryErrors: string[];
  onJumpToTasks: () => void;
  onJumpToField: (fieldId: string) => void;
  onJumpToLaundry: () => void;
  /** Draft save state and busy notes, rendered under the list. */
  children?: React.ReactNode;
}

function blockerLabel(error: FormBlocker): string {
  return error.sectionLabel && error.sectionLabel !== error.label
    ? `${stripHtmlToText(error.sectionLabel)}: ${stripHtmlToText(error.label)}`
    : stripHtmlToText(error.label);
}

function JumpRow({ where, children, onClick }: { where: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--e-radius)] px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-surface))] focus-visible:outline focus-visible:outline-2"
      >
        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-danger))] text-[0.6875rem] font-[700] text-white">!</span>
        <span className="min-w-0 flex-1">
          <span className="block font-[550] text-[hsl(var(--e-foreground))]">{children}</span>
          <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{where}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
      </button>
    </li>
  );
}

export function SubmitBlockers({
  syncBlockers,
  tasksPending,
  formErrors,
  laundryErrors,
  onJumpToTasks,
  onJumpToField,
  onJumpToLaundry,
  children,
}: SubmitBlockersProps) {
  const total = formErrors.length + laundryErrors.length + Number(tasksPending) + syncBlockers.length;

  return (
    <section aria-labelledby="wrapup-before-submit" className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-surface))] p-4 shadow-[var(--e-elevation-gold)]">
      <h2 id="wrapup-before-submit" className="font-semibold">Before you submit</h2>
      {total === 0 ? (
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-success))]">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Nothing stops the submit.
        </p>
      ) : (
        <div aria-label="Submission checks" className={`rounded-[var(--e-radius)] ${toneNoticeClass("problem")} p-2.5`}>
          <p className="flex items-center gap-1.5 px-1 text-[0.8125rem] font-[600]">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-danger))]" aria-hidden />
            {total} check{total === 1 ? "" : "s"} to finish
          </p>
          <p className="px-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Tap one to jump there.</p>
          <ul className="mt-1.5 space-y-0.5">
            {tasksPending ? (
              <JumpRow where="Clean" onClick={onJumpToTasks}>Mark every checklist item done or not done in Clean.</JumpRow>
            ) : null}
            {formErrors.map((error) => (
              <JumpRow key={error.fieldId} where="Clean" onClick={() => onJumpToField(error.fieldId)}>{blockerLabel(error)}</JumpRow>
            ))}
            {laundryErrors.map((message, index) => (
              <JumpRow key={`laundry-${index}`} where="Wrap up · Laundry handoff" onClick={onJumpToLaundry}>{message}</JumpRow>
            ))}
          </ul>
          {syncBlockers.length > 0 ? (
            <ul className="mt-2 space-y-1 border-t border-[hsl(var(--e-border))] px-1 pt-2">
              {syncBlockers.map((message) => (
                <li key={message} className="flex items-start gap-2 text-sm" role="status">
                  <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" aria-hidden />
                  <span>{message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {children}
    </section>
  );
}
