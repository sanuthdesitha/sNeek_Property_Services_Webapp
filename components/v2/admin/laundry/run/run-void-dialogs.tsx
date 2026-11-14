"use client";

/**
 * "Void this run" and "Undo void" (board LaundryRunActions; tiers from board
 * "Confirmations and deletes", 2026-11-14). Both are tier C: a required quick-
 * pick reason (no minimum length) and the person's own PIN, verified by the
 * server. Void is offered on Skipped and Flagged runs and on failed runs still
 * waiting for pickup. What it removes and keeps sits under a disclosure. A run
 * on an emailed laundry report is refused by the server with the reason, and
 * the dialog says so instead of offering the button. With several runs one
 * reason and one PIN cover the batch and each run answers with its outcome.
 */
import * as React from "react";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";
import { requestUndoVoid, requestVoid, RunRequestError, type RunOutcome, type RunVersion } from "./run-requests";

export type VoidRun = RunVersion & { name: string; status: string };

function VoidEffects() {
  return (
    <div className="space-y-2">
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
    </div>
  );
}

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
  const [notifyTeam, setNotifyTeam] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const runKey = runs?.map((run) => run.taskId).join("|") ?? "";
  React.useEffect(() => {
    setNotifyTeam(false);
    setError(null);
  }, [runKey]);
  if (!runs || !runs.length) return null;
  const single = runs.length === 1 ? runs[0] : null;

  async function submit(reason: string, credentials: NonNullable<Parameters<typeof requestVoid>[3]>) {
    if (emailedReport || !runs) return;
    setBusy(true);
    setError(null);
    try {
      const outcomes = await requestVoid(runs.map(({ taskId, expectedUpdatedAt }) => ({ taskId, expectedUpdatedAt })), reason, notifyTeam, credentials);
      onDone(outcomes);
    } catch (cause) {
      setError(cause instanceof RunRequestError ? `Not voided. ${sensitiveVerificationText(cause.message)}` : "Not voided. Your answers are kept; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EConfirmDialog
      open={open}
      tier="sensitive"
      title={single ? `Void ${single.name}?` : `Void ${runs.length} runs?`}
      description={
        single
          ? "It leaves the pipeline, the laundry portal, counts and reports. It is kept in history and can be undone."
          : `${runs.map((run) => run.name).join(", ")}. They leave the pipeline, the laundry portal, counts and reports; each is kept in history and can be undone.`
      }
      reason={emailedReport ? undefined : { label: "Reason", choices: REASON_CHOICES.laundryVoid }}
      details={{ label: "What voiding removes and keeps", content: <VoidEffects /> }}
      busy={busy}
      error={error}
      confirmDisabled={Boolean(emailedReport)}
      confirmLabel={single ? "Void run" : `Void ${runs.length} runs`}
      onClose={onClose}
      onConfirm={async ({ reason, credentials }) => {
        if (!reason || !credentials) return;
        await submit(reason, credentials);
      }}
    >
      {emailedReport ? (
        <EToneNotice tone="problem" title="This run cannot be voided">
          <p>It is on a laundry report that was {emailedReport}. An issued record is never rewritten. Put the correction on the next laundry report instead.</p>
        </EToneNotice>
      ) : null}
      {nextCleanNote ? <EToneNotice tone="attention" title="Linen for the next clean"><p>{nextCleanNote} Plan clean linen for it; a replacement linen delivery is not built yet.</p></EToneNotice> : null}
      <label className="flex min-h-11 items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" checked={notifyTeam} disabled={busy} onChange={(e) => setNotifyTeam(e.target.checked)} /> Tell the laundry team in their portal inbox
      </label>
    </EConfirmDialog>
  );
}

export function RunUndoVoidDialog({ run, previousState, onClose, onDone }: {
  run: VoidRun | null;
  previousState: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setError(null);
  }, [run?.taskId]);
  if (!run) return null;
  return (
    <EConfirmDialog
      open
      tier="sensitive"
      title={`Undo the void of ${run.name}?`}
      description={previousState ? `The run goes back to ${previousState}, as it was before the void, and counts again.` : "The run goes back to its state before the void and counts again."}
      reason={{ label: "Reason", choices: REASON_CHOICES.laundryUndoVoid }}
      busy={busy}
      error={error}
      confirmLabel="Undo void"
      onClose={onClose}
      onConfirm={async ({ reason, credentials }) => {
        if (!reason || !credentials) return;
        setBusy(true);
        setError(null);
        try {
          await requestUndoVoid({ taskId: run.taskId, expectedUpdatedAt: run.expectedUpdatedAt }, reason, credentials);
          onDone();
        } catch (cause) {
          setError(cause instanceof RunRequestError ? `Not undone. ${sensitiveVerificationText(cause.message)}` : "Not undone. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    />
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
