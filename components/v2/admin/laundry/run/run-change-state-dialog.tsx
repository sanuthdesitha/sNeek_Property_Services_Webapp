"use client";

/**
 * "Change state" (board LaundryRunActions): the office records what actually
 * happened on a run. A later state asks for the real date and time (empty to
 * start, never "now"), who did it, optional bags, weight and price (blank
 * stays "Not recorded") and a reason, and shows what will change and what
 * will not. Moving back is allowed after a warning. Fields freeze while
 * saving; a failure keeps every answer. With several runs it sends one state
 * and one real time for all and lists each run's outcome.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import {
  CHANGE_STATE_LABELS,
  CHANGE_STATE_TARGETS,
  currentTarget,
  isBackwardsChange,
  stateName,
  type ChangeStateTarget,
} from "@/lib/laundry/run-correction-rules";
import type { RunDoneByOption } from "@/lib/laundry/run-page-types";
import { localToIso, optionalNumber, requestChangeState, RunRequestError, type RunOutcome, type RunVersion } from "./run-requests";

export type ChangeStateRun = RunVersion & {
  name: string;
  status: string;
  pickedUpAt: string | null;
  droppedAt: string | null;
  onEmailedReport: boolean;
};

type Props = {
  runs: ChangeStateRun[] | null;
  doneByOptions: RunDoneByOption[];
  skipReasons: Array<{ value: string; label: string }>;
  handoffWhen?: string | null;
  timeZone: string;
  onClose: () => void;
  onSaved: (outcomes: RunOutcome[]) => void;
};

type Draft = {
  target: ChangeStateTarget | null;
  date: string;
  time: string;
  pickupDate: string;
  pickupTime: string;
  doneById: string;
  bags: string;
  weight: string;
  price: string;
  reason: string;
  skipReasonCode: string;
  flagNote: string;
  acknowledgeBackwards: boolean;
  notifyTeam: boolean;
};

const EMPTY: Draft = { target: null, date: "", time: "", pickupDate: "", pickupTime: "", doneById: "", bags: "", weight: "", price: "", reason: "", skipReasonCode: "", flagNote: "", acknowledgeBackwards: false, notifyTeam: false };

const FIELD = "h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:h-9 sm:text-[0.875rem] disabled:opacity-60";
const LABEL = "block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]";

const LATER = new Set<ChangeStateTarget>(["PICKED_UP", "READY_TO_RETURN", "DROPPED"]);

function eventWord(target: ChangeStateTarget): string {
  return target === "DROPPED" ? "Dropped off on" : target === "READY_TO_RETURN" ? "Ready to return on" : "Picked up on";
}

export function RunChangeStateDialog({ runs, doneByOptions, skipReasons, handoffWhen, timeZone, onClose, onSaved }: Props) {
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const runKey = runs?.map((run) => `${run.taskId}:${run.expectedUpdatedAt}`).join("|") ?? "";
  // A different run (or set of runs) starts a fresh draft.
  React.useEffect(() => {
    setDraft(EMPTY);
    setError(null);
  }, [runKey]);

  if (!runs || runs.length === 0) return null;
  const single = runs.length === 1 ? runs[0] : null;
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const target = draft.target;
  const later = target ? LATER.has(target) : false;
  const needsPickup = Boolean(target && (target === "READY_TO_RETURN" || target === "DROPPED") && runs.some((run) => !run.pickedUpAt));
  const backwards = target ? runs.some((run) => isBackwardsChange(run, target)) : false;
  const blockedByReport = target ? runs.some((run) => run.onEmailedReport && isBackwardsChange(run, target) && run.status === "DROPPED") : false;
  const happenedAt = later ? localToIso(draft.date, draft.time, timeZone) : null;
  const pickedUpAt = needsPickup ? localToIso(draft.pickupDate, draft.pickupTime, timeZone) : null;

  const problem = !target
    ? "Choose what actually happened."
    : later && !happenedAt
      ? "Enter the date and time it happened."
      : needsPickup && !pickedUpAt
        ? "Enter when it was picked up."
        : later && !draft.doneById
          ? "Choose who did it."
          : target === "SKIPPED" && !draft.skipReasonCode
            ? "Choose the skip reason."
            : target === "FLAGGED" && !draft.flagNote.trim()
              ? "Write what needs deciding."
              : draft.reason.trim().length < 3
                ? "Give the reason for the correction."
                : backwards && !draft.acknowledgeBackwards
                  ? "Confirm the warning about moving back."
                  : blockedByReport
                    ? "A run on an emailed report cannot move back past Dropped off."
                    : null;

  async function save() {
    if (problem || !target || !runs) return;
    setBusy(true);
    setError(null);
    try {
      const outcomes = await requestChangeState(runs.map(({ taskId, expectedUpdatedAt }) => ({ taskId, expectedUpdatedAt })), {
        target,
        happenedAt,
        pickedUpAt,
        doneById: later ? draft.doneById : null,
        reason: draft.reason.trim(),
        skipReasonCode: target === "SKIPPED" ? draft.skipReasonCode : null,
        flagNote: target === "FLAGGED" ? draft.flagNote.trim() : null,
        bagCount: optionalNumber(draft.bags),
        weightKg: optionalNumber(draft.weight),
        price: optionalNumber(draft.price),
        acknowledgeBackwards: draft.acknowledgeBackwards,
        notifyTeam: draft.notifyTeam,
      });
      onSaved(outcomes);
    } catch (cause) {
      setError(cause instanceof RunRequestError ? cause.message : "Not saved. Your answers are kept; try again.");
    } finally {
      setBusy(false);
    }
  }

  const now = single ? currentTarget(single.status) : null;
  return (
    <EActionDialog
      open
      eyebrow="Change state"
      title={single ? single.name : `${runs.length} runs`}
      description={single ? <>Now: <b>{stateName(single.status)}</b>{handoffWhen ? ` · cleaner's handoff ${handoffWhen}` : ""}</> : "One state and one real time for every selected run. Each run is checked on its own."}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <EButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</EButton>
          <span className="hidden flex-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:block">Fields lock while saving; a failed save keeps your answers.</span>
          <EButton onClick={() => void save()} disabled={busy || Boolean(problem)} title={problem ?? undefined}>{busy ? "Saving…" : "Save correction"}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-3">
        <legend className={LABEL}>What actually happened?</legend>
        <div role="radiogroup" aria-label="State" className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {CHANGE_STATE_TARGETS.map((option) => (
            <label key={option} className={`flex min-h-11 cursor-pointer items-start gap-2 border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem] first:border-t-0 ${target === option ? "bg-[hsl(var(--e-primary-soft))]" : ""}`}>
              <input type="radio" name="run-target" className="mt-1" checked={target === option} disabled={option === now} onChange={() => set({ target: option, acknowledgeBackwards: false })} />
              <span className="flex-1"><b>{CHANGE_STATE_LABELS[option].label}</b> <span className="text-[hsl(var(--e-muted-foreground))]">· {CHANGE_STATE_LABELS[option].hint}</span></span>
              {option === now ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Now</span> : null}
            </label>
          ))}
        </div>

        {needsPickup ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
            <label className={LABEL}>Picked up on<input type="date" className={FIELD} value={draft.pickupDate} onChange={(e) => set({ pickupDate: e.target.value })} /></label>
            <label className={LABEL}>at<input type="time" className={FIELD} value={draft.pickupTime} onChange={(e) => set({ pickupTime: e.target.value })} /></label>
          </div>
        ) : null}
        {later && target ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
            <label className={LABEL}>{eventWord(target)}<input type="date" className={FIELD} value={draft.date} onChange={(e) => set({ date: e.target.value })} /></label>
            <label className={LABEL}>at<input type="time" className={FIELD} value={draft.time} onChange={(e) => set({ time: e.target.value })} /></label>
            <label className={`${LABEL} col-span-2 sm:col-span-1`}>Done by
              <select className={FIELD} value={draft.doneById} onChange={(e) => set({ doneById: e.target.value })}>
                <option value="">Choose who did it</option>
                {doneByOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <p className="col-span-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:col-span-3">Date and time start empty: we never assume "now". The time cannot be in the future or before the cleaner's handoff.</p>
          </div>
        ) : null}
        {target === "SKIPPED" ? (
          <label className={LABEL}>Skip reason
            <select className={FIELD} value={draft.skipReasonCode} onChange={(e) => set({ skipReasonCode: e.target.value })}>
              <option value="">Choose a reason</option>
              {skipReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
          </label>
        ) : null}
        {target === "FLAGGED" ? (
          <label className={LABEL}>What needs deciding<input className={FIELD} value={draft.flagNote} onChange={(e) => set({ flagNote: e.target.value })} /></label>
        ) : null}
        {later ? (
          <div className="grid grid-cols-3 gap-2">
            <label className={LABEL}>Bags<input inputMode="numeric" className={FIELD} placeholder="Not known" value={draft.bags} onChange={(e) => set({ bags: e.target.value })} /></label>
            <label className={LABEL}>Weight, kg<input inputMode="decimal" className={FIELD} placeholder="Not known" value={draft.weight} onChange={(e) => set({ weight: e.target.value })} /></label>
            <label className={LABEL}>Price, $<input inputMode="decimal" className={FIELD} placeholder="Not known" value={draft.price} onChange={(e) => set({ price: e.target.value })} /></label>
            <p className="col-span-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Optional. Blank stays "Not recorded", never 0.</p>
          </div>
        ) : null}
        <label className={LABEL}>Reason, required
          <textarea className={`${FIELD} h-20 py-2`} value={draft.reason} onChange={(e) => set({ reason: e.target.value })} />
        </label>

        {target ? (
          <EToneNotice tone="info" title="What will change">
            <ul className="list-disc space-y-0.5 pl-4">
              <li>State: {single ? stateName(single.status) : "each run's state"} → {CHANGE_STATE_LABELS[target].label}</li>
              {later ? <li>{eventWord(target).replace(" on", "")} recorded as {draft.date && draft.time ? `${draft.date} ${draft.time}` : "the time you enter"} by office correction</li> : null}
              {target === "NOT_PICKED_UP" ? <li>Pickup and drop-off times leave the current state (kept in History)</li> : null}
              <li>A new "Office correction" entry in History with the before, after and your reason</li>
            </ul>
          </EToneNotice>
        ) : null}
        <EToneNotice tone="attention" title="What will not happen">
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              No message to the laundry team unless you tick this:{" "}
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.notifyTeam} onChange={(e) => set({ notifyTeam: e.target.checked })} /> Tell them in their portal inbox</label>
            </li>
            <li>No photo is made up: the run shows "No photo, office correction" until the team's own record arrives, which is kept beside it</li>
            <li>No change to emailed laundry reports or the linked job</li>
          </ul>
        </EToneNotice>
        {backwards ? (
          <EToneNotice tone="problem" title="Moving back">
            <p>Times and photos of the later stages leave the current state but stay in History.{blockedByReport ? " This run is on an emailed laundry report, so it cannot move back past Dropped off." : ""}</p>
            {!blockedByReport ? <label className="mt-1 flex items-center gap-1.5"><input type="checkbox" checked={draft.acknowledgeBackwards} onChange={(e) => set({ acknowledgeBackwards: e.target.checked })} /> I understand, move it back</label> : null}
          </EToneNotice>
        ) : null}
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        {problem && target ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{problem}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}
