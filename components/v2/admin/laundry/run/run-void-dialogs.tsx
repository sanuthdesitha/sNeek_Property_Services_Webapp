"use client";

/**
 * "Void this run" and "Undo void" (board LaundryRunActions). Void is offered on
 * Skipped and Flagged runs and on failed runs still waiting for pickup; it
 * needs a reason and the person's own PIN, and says what it removes and what
 * it keeps. A run on an emailed laundry report is refused by the server with
 * the reason. With several runs one reason and one PIN cover the batch and
 * each run answers with its outcome.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { requestUndoVoid, requestVoid, RunRequestError, type RunOutcome, type RunVersion } from "./run-requests";

export type VoidRun = RunVersion & { name: string; status: string };

const FIELD = "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[16px] sm:text-[0.875rem] disabled:opacity-60";
const LABEL = "block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]";

export function RunVoidDialog({ runs, nextCleanNote, emailedReport, onClose, onDone }: {
  runs: VoidRun[] | null;
  /** "Next clean J-1049, Sat 14 Nov 10:00, still needs linen." (single run only). */
  nextCleanNote?: string | null;
  /** When the run is known to be on an emailed report, the refusal is shown up front. */
  emailedReport?: string | null;
  onClose: () => void;
  onDone: (outcomes: RunOutcome[]) => void;
}) {
  const open = Boolean(runs && runs.length);
  const pin = useOwnPinPrompt(open);
  const [reason, setReason] = React.useState("");
  const [notifyTeam, setNotifyTeam] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const runKey = runs?.map((run) => run.taskId).join("|") ?? "";
  React.useEffect(() => {
    setReason("");
    setNotifyTeam(false);
    setError(null);
  }, [runKey]);
  if (!runs || !runs.length) return null;
  const single = runs.length === 1 ? runs[0] : null;
  const problem = emailedReport ? "This run is on an emailed laundry report." : reason.trim().length < 3 ? "Give the reason for the void." : pin.problem;

  async function submit() {
    if (problem || !pin.credentials || !runs) return;
    setBusy(true);
    setError(null);
    try {
      const outcomes = await requestVoid(runs.map(({ taskId, expectedUpdatedAt }) => ({ taskId, expectedUpdatedAt })), reason.trim(), notifyTeam, pin.credentials);
      pin.reset();
      onDone(outcomes);
    } catch (cause) {
      setError(cause instanceof RunRequestError ? cause.message : "Not voided. Your answers are kept; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open
      eyebrow="Void this run"
      title={single ? single.name : `Void ${runs.length} runs`}
      description="Voiding says this run should never have counted. Offered on skipped and flagged runs, and on failed pickups still waiting."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <EButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton variant="danger" onClick={() => void submit()} disabled={busy || Boolean(problem)} title={problem ?? undefined}>{busy ? "Voiding…" : single ? "Void run" : `Void ${runs.length} runs`}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-3">
        {emailedReport ? (
          <EToneNotice tone="problem" title="This run cannot be voided">
            <p>It is on a laundry report that was {emailedReport}. An issued record is never rewritten. Put the correction on the next laundry report instead.</p>
          </EToneNotice>
        ) : null}
        <label className={LABEL}>Reason, required
          <textarea className={`${FIELD} h-20`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <EToneNotice tone="problem" title="Voiding removes it from">
          <ul className="list-disc space-y-0.5 pl-4">
            <li>The Pipeline and Completed history (shown only under "Voided")</li>
            <li>The laundry portal: Today, Runs, Tracking, route stops and From the office</li>
            <li>Calendar laundry counts, overdue and failed-pickup alerts and nudges</li>
            <li>Statistics, team metrics, laundry reports (admin and partner) and the job margin's laundry cost</li>
            <li>A waiting skip request in Approvals closes as "Voided by office"</li>
          </ul>
        </EToneNotice>
        <EToneNotice tone="info" title="Kept">
          <ul className="list-disc space-y-0.5 pl-4">
            <li>The run, photos and reports, in History as "Voided" with who, when and why</li>
            <li>Undo void (administrators) restores the state before the void</li>
            <li>The linked job is not changed</li>
          </ul>
        </EToneNotice>
        {nextCleanNote ? <EToneNotice tone="attention" title="Linen for the next clean"><p>{nextCleanNote} Plan clean linen for it; a replacement linen delivery is not built yet.</p></EToneNotice> : null}
        <label className="flex items-center gap-2 text-[0.8125rem]"><input type="checkbox" checked={notifyTeam} onChange={(e) => setNotifyTeam(e.target.checked)} /> Tell the laundry team in their portal inbox</label>
        <OwnPinFields {...pin.fieldProps} disabled={busy} />
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}

export function RunUndoVoidDialog({ run, previousState, onClose, onDone }: {
  run: VoidRun | null;
  previousState: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const pin = useOwnPinPrompt(Boolean(run));
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setReason("");
    setError(null);
  }, [run?.taskId]);
  if (!run) return null;
  async function submit() {
    if (!pin.credentials || !run) return;
    setBusy(true);
    setError(null);
    try {
      await requestUndoVoid({ taskId: run.taskId, expectedUpdatedAt: run.expectedUpdatedAt }, reason.trim(), pin.credentials);
      pin.reset();
      onDone();
    } catch (cause) {
      setError(cause instanceof RunRequestError ? cause.message : "Not undone. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <EActionDialog
      open
      eyebrow="Undo void"
      title={run.name}
      description={previousState ? `The run goes back to ${previousState}, as it was before the void.` : "The run goes back to its state before the void."}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <EButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton onClick={() => void submit()} disabled={busy || Boolean(pin.problem)} title={pin.problem ?? undefined}>{busy ? "Undoing…" : "Undo void"}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-3">
        <label className={LABEL}>Note, optional<input className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <OwnPinFields {...pin.fieldProps} disabled={busy} />
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}

/** Bulk results: every run answers voided / changed, or not, with its reason. */
export function RunOutcomeList({ title, outcomes, names, okLabel, onClose }: {
  title: string;
  outcomes: RunOutcome[];
  names: Record<string, string>;
  okLabel: string;
  onClose: () => void;
}) {
  const done = outcomes.filter((outcome) => outcome.ok).length;
  return (
    <section role="status" aria-label={title} className="space-y-1.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.8125rem]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>{title}</b>
        <span>{done} {okLabel}{outcomes.length - done ? ` · ${outcomes.length - done} not` : ""}</span>
      </div>
      <ul className="space-y-1">
        {outcomes.map((outcome) => (
          <li key={outcome.taskId} className="flex gap-2">
            <span aria-hidden className={outcome.ok ? "text-[hsl(var(--e-success))]" : "text-[hsl(var(--e-danger))]"}>{outcome.ok ? "✓" : "✕"}</span>
            <span><b>{names[outcome.taskId] ?? "Run"}</b>{outcome.ok ? ` ${okLabel}` : `: ${outcome.message ?? "not saved"}`}</span>
          </li>
        ))}
      </ul>
      <EButton size="sm" variant="ghost" onClick={onClose}>Dismiss</EButton>
    </section>
  );
}
