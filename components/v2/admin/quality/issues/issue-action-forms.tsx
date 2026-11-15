"use client";

/**
 * The three action forms of a QA issue (record the fix, propose a deduction,
 * escalate) and the false-confirmation decision, shared by the desktop issue
 * panel (inline) and the phone sheets (board "M-QualityDetail", frames 1–3).
 *
 * Every form submits through patchIssue to the EXISTING endpoint
 * PATCH /api/admin/qa/issues/[id], so the rules stay the endpoint's: who fixed
 * it decides who is paid, a deduction is only a PENDING pay adjustment that
 * waits in Approvals, and a false confirmation is confirmed or rejected by a
 * person. Fields freeze while a save runs; a failed save keeps what was typed
 * and says it was not recorded.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";
import { FIXED_RECTIFICATION_STATUSES, type RectificationStatusKey } from "@/lib/quality/types";
import { FIXED_BY_LABEL, NOT_FIXED_CHOICES } from "@/lib/quality/issue-presentation";
import { keyList } from "./issue-format";
import { PhotoPicker, uploadRectificationPhoto, type PickedPhoto } from "./issue-evidence";
import { patchIssue, type IssueActionBody } from "./issue-requests";

export type IssueActionKey = "rectify" | "deduction" | "escalate";

/** What a person has typed into an issue's forms but not sent yet. */
export type IssueDraft = {
  issueId: string;
  rectify: { status: string; minutes: string; before: PickedPhoto[]; after: PickedPhoto[] };
  deduction: { amount: string; note: string };
  escalate: { reason: string };
};

export function emptyIssueDraft(issue: Pick<QualityIssueRow, "id" | "rectificationStatus">): IssueDraft {
  return {
    issueId: issue.id,
    // Starts on the issue's current status, as the old drawer did: choosing who
    // fixed it is deliberate, because it decides who is paid.
    rectify: { status: issue.rectificationStatus || "FIXED_BY_QA", minutes: "", before: [], after: [] },
    deduction: { amount: "", note: "" },
    escalate: { reason: "" },
  };
}

export type IssueSubmitState = {
  busy: boolean;
  error: string | null;
  submit: (body: IssueActionBody, successMessage: string) => Promise<boolean>;
  clearError: () => void;
};

/** One save at a time per issue; the caller re-reads after a success. */
export function useIssueSubmit(issueId: string, onChanged: () => void | Promise<void>): IssueSubmitState {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef(false);

  const submit = React.useCallback(
    async (body: IssueActionBody, successMessage: string) => {
      if (pending.current) return false;
      pending.current = true;
      setBusy(true);
      setError(null);
      const result = await patchIssue(issueId, body);
      pending.current = false;
      setBusy(false);
      if (!result.ok) {
        setError(`It was not recorded: ${result.error}`);
        return false;
      }
      toast({ title: successMessage });
      await onChanged();
      return true;
    },
    [issueId, onChanged],
  );

  return { busy, error, submit, clearError: React.useCallback(() => setError(null), []) };
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))] [overflow-wrap:anywhere]">
      {message}
    </p>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.6875rem] font-[650] uppercase tracking-[0.08em] text-[hsl(var(--e-accent-portal,var(--e-text-faint)))]">{children}</p>;
}

type DraftProps<K extends keyof Omit<IssueDraft, "issueId">> = {
  draft: IssueDraft[K];
  onDraft: (next: IssueDraft[K]) => void;
};

type FormShellProps = {
  /** "sheet": the phone bottom sheet (full-width button; Cancel is in the sheet header). */
  layout: "inline" | "sheet";
  busy: boolean;
  error: string | null;
  onCancel: () => void;
};

function FormButtons({
  layout,
  busy,
  disabled,
  label,
  onCancel,
  onSubmit,
}: {
  layout: "inline" | "sheet";
  busy: boolean;
  disabled?: boolean;
  label: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (layout === "sheet") {
    return (
      <EButton className="w-full" size="lg" disabled={busy || disabled} onClick={onSubmit}>
        {busy ? "Sending…" : label}
      </EButton>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EButton size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </EButton>
      <EButton size="sm" disabled={busy || disabled} onClick={onSubmit}>
        {busy ? "Sending…" : label}
      </EButton>
    </div>
  );
}

const SEGMENT =
  "min-h-11 flex-1 rounded-[var(--e-radius-sm)] px-3 text-[0.875rem] font-[550] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]";
const CHIP =
  "min-h-11 rounded-full border px-3.5 text-[0.8125rem] font-[550] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]";

/* ── Record the fix ─────────────────────────────────────────────────────── */

export function RectifyForm({
  issue,
  draft,
  onDraft,
  layout,
  busy,
  error,
  onCancel,
  onSave,
}: DraftProps<"rectify"> &
  FormShellProps & {
    issue: QualityIssueRow;
    onSave: (body: IssueActionBody) => void;
  }) {
  const [uploadingSide, setUploadingSide] = React.useState<null | "before" | "after">(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const savedBefore = React.useMemo(() => keyList(issue.rectificationBeforeKeys), [issue]);
  const savedAfter = React.useMemo(() => keyList(issue.rectificationAfterKeys), [issue]);
  const frozen = busy || uploadingSide !== null;
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  async function addPhotos(side: "before" | "after", files: FileList | null) {
    if (!files?.length) return;
    setUploadingSide(side);
    setUploadError(null);
    try {
      const uploaded: PickedPhoto[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadRectificationPhoto(file));
      const current = draftRef.current;
      onDraft(side === "before" ? { ...current, before: [...current.before, ...uploaded] } : { ...current, after: [...current.after, ...uploaded] });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Could not upload that photo. Remove it and attach the file again.");
    } finally {
      setUploadingSide(null);
    }
  }

  function save() {
    const minutes = draft.minutes.trim() ? Number(draft.minutes) : undefined;
    onSave({
      action: "rectify",
      status: draft.status,
      minutes: minutes !== undefined && Number.isFinite(minutes) ? minutes : undefined,
      // The endpoint REPLACES each side's key array, so saved keys are resent
      // with the new ones; a side with nothing new is not written at all.
      beforeKeys: draft.before.length ? [...savedBefore, ...draft.before.map((photo) => photo.key)] : undefined,
      afterKeys: draft.after.length ? [...savedAfter, ...draft.after.map((photo) => photo.key)] : undefined,
    });
  }

  const minutesInvalid = draft.minutes.trim() !== "" && (!Number.isInteger(Number(draft.minutes)) || Number(draft.minutes) < 0);
  const fixed = (FIXED_RECTIFICATION_STATUSES as readonly string[]).includes(draft.status);

  return (
    <fieldset disabled={frozen} className="min-w-0 space-y-3">
      <legend className="sr-only">Record the fix</legend>
      <div className="space-y-1.5">
        <Eyebrow>Who fixed it</Eyebrow>
        <div role="group" aria-label="Who fixed it" className="flex gap-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-1">
          {FIXED_RECTIFICATION_STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.status === value}
              onClick={() => onDraft({ ...draft, status: value })}
              className={cn(SEGMENT, draft.status === value ? "bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-text-secondary))]")}
            >
              {FIXED_BY_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Eyebrow>Or it is not fixed</Eyebrow>
        <div role="group" aria-label="Or it is not fixed" className="flex flex-wrap gap-2">
          {NOT_FIXED_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={draft.status === choice.value}
              onClick={() => onDraft({ ...draft, status: choice.value as RectificationStatusKey })}
              className={cn(
                CHIP,
                draft.status === choice.value
                  ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft,var(--e-muted)))] text-[hsl(var(--e-foreground))]"
                  : "border-[hsl(var(--e-border-strong,var(--e-border)))] text-[hsl(var(--e-text-secondary))]",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
      <EField label="Minutes spent fixing" hint={minutesInvalid ? "Enter whole minutes, 0 or more." : undefined}>
        <EInput
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          className="max-sm:text-[16px]"
          value={draft.minutes}
          onChange={(event) => onDraft({ ...draft, minutes: event.target.value })}
        />
      </EField>
      <div className="grid gap-3 sm:grid-cols-2">
        <PhotoPicker
          label="Before the fix"
          items={draft.before}
          uploading={uploadingSide === "before"}
          disabled={frozen}
          onFiles={(files) => void addPhotos("before", files)}
          onRemove={(index) => onDraft({ ...draft, before: draft.before.filter((_, i) => i !== index) })}
        />
        <PhotoPicker
          label="After the fix"
          items={draft.after}
          uploading={uploadingSide === "after"}
          disabled={frozen}
          onFiles={(files) => void addPhotos("after", files)}
          onRemove={(index) => onDraft({ ...draft, after: draft.after.filter((_, i) => i !== index) })}
        />
      </div>
      {fixed ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          An after photo is not required, but &quot;No after photo&quot; is written on the issue.
        </p>
      ) : null}
      <FormError message={uploadError ?? error} />
      <FormButtons layout={layout} busy={busy} disabled={minutesInvalid || uploadingSide !== null} label="Save fix" onCancel={onCancel} onSubmit={save} />
    </fieldset>
  );
}

/* ── Propose a deduction ────────────────────────────────────────────────── */

export function DeductionForm({
  issue,
  draft,
  onDraft,
  layout,
  busy,
  error,
  onCancel,
  onSave,
}: DraftProps<"deduction"> &
  FormShellProps & {
    issue: QualityIssueRow;
    onSave: (body: IssueActionBody) => void;
  }) {
  const [problem, setProblem] = React.useState<string | null>(null);
  function save() {
    const amount = Number(draft.amount);
    if (!draft.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      setProblem("Enter an amount greater than zero.");
      return;
    }
    if (!draft.note.trim()) {
      setProblem("A note is required.");
      return;
    }
    setProblem(null);
    onSave({ action: "proposeDeduction", amount, note: draft.note.trim() });
  }
  const who = [issue.cleaner?.name, issue.job?.propertyName ?? issue.property?.name, issue.job?.jobNumber].filter(Boolean).join(" · ");
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <legend className="sr-only">Propose a deduction</legend>
      {who ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{who}</p> : null}
      <div className={cn("grid gap-3", layout === "inline" && "sm:grid-cols-[9rem_minmax(0,1fr)]")}>
        <EField label="Amount (AUD)">
          <EInput
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="max-sm:text-[16px]"
            value={draft.amount}
            onChange={(event) => onDraft({ ...draft, amount: event.target.value })}
          />
        </EField>
        <EField label="Note, required">
          <EInput className="max-sm:text-[16px]" value={draft.note} onChange={(event) => onDraft({ ...draft, note: event.target.value })} />
        </EField>
      </div>
      <p className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-band-info-bg,var(--e-muted)))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-band-info-fg,var(--e-text-secondary)))]">
        A proposal waits in Approvals › Pay adjustments. Nothing is deducted until someone approves it.
      </p>
      <FormError message={problem ?? error} />
      <FormButtons layout={layout} busy={busy} label={error ? "Try again" : "Propose deduction"} onCancel={onCancel} onSubmit={save} />
      {layout === "sheet" ? (
        <p className="text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Fields lock while sending. If it fails, your note stays and the button says Try again.
        </p>
      ) : null}
    </fieldset>
  );
}

/* ── Escalate ───────────────────────────────────────────────────────────── */

export function EscalateForm({
  draft,
  onDraft,
  layout,
  busy,
  error,
  onCancel,
  onSave,
}: DraftProps<"escalate"> & FormShellProps & { onSave: (body: IssueActionBody) => void }) {
  const [problem, setProblem] = React.useState<string | null>(null);
  function save() {
    if (!draft.reason.trim()) {
      setProblem("A reason is required.");
      return;
    }
    setProblem(null);
    onSave({ action: "escalate", reason: draft.reason.trim() });
  }
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <legend className="sr-only">Escalate</legend>
      <EField label="Escalation reason" hint="Opens a management review record for the cleaner.">
        <ETextarea rows={3} className="max-sm:text-[16px]" value={draft.reason} onChange={(event) => onDraft({ ...draft, reason: event.target.value })} />
      </EField>
      <FormError message={problem ?? error} />
      <FormButtons layout={layout} busy={busy} label="Escalate issue" onCancel={onCancel} onSubmit={save} />
    </fieldset>
  );
}

export const ISSUE_ACTION_TITLE: Readonly<Record<IssueActionKey, string>> = {
  rectify: "Record the fix",
  deduction: "Propose a deduction",
  escalate: "Escalate",
};
