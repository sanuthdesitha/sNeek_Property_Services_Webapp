"use client";

/**
 * Step two of a change: what will change in plain words, from when, what the
 * dry run says it affects, and "Test against last month". Publishing needs a
 * reason, the reviewed checkbox, and the person's own PIN again in the final
 * confirmation (two steps). Nothing here saves until Publish succeeds; on any
 * failure the draft, date, reason and choices are kept.
 */
import * as React from "react";
import { EAlert, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { EConfirmModal, EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { formatRuleValue } from "@/lib/scheduling-rules/registry";
import type { DraftChange, RuleDraft } from "@/lib/scheduling-rules/draft";
import type { SchedulingRulesView } from "@/lib/scheduling-rules/view-types";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";

type PreviewBody = {
  laundry: { checked: boolean; properties: number; newRunsChanged: number; existingRunsReplanned: number; samples: Array<{ propertyName: string; cleanDate: string; from: string; to: string; existing: boolean }> };
  jobs: { checked: boolean; futureTurnovers: number; existingTurnoversRetimed: number; samples: Array<{ propertyName: string; date: string; from: string; to: string }> };
  recurring: { checked: boolean; liveWouldCreate: number; candidateWouldCreate: number };
  runTimeKeys: string[];
};

type SimulationBody = {
  from: string;
  to: string;
  laundry: { cleans: number; differ: number; samples: Array<{ propertyName: string; cleanDate: string; current: string; candidate: string; actual: string | null }> };
  jobs: { turnovers: number; differ: number; samples: Array<{ propertyName: string; date: string; current: string; candidate: string }> };
};

type AsyncState<T> = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export type PublishRequest = {
  effectiveFrom: string;
  reason: string;
  appliesToExisting: boolean;
  credentials: SensitiveCredentialsInput;
};

type Props = {
  view: SchedulingRulesView;
  draft: RuleDraft;
  changes: DraftChange[];
  token: string;
  publishing: boolean;
  publishError: string | null;
  onBack: () => void;
  onPublish: (request: PublishRequest) => Promise<void>;
};

function titleOf(view: SchedulingRulesView, key: string): string {
  return view.rules.find((row) => row.editableKey === key)?.title ?? key;
}

export function ReviewPanel({ view, draft, changes, token, publishing, publishError, onBack, onPublish }: Props) {
  const [effectiveFrom, setEffectiveFrom] = React.useState(view.earliestEffectiveFrom);
  const [reason, setReason] = React.useState("");
  const [appliesToExisting, setAppliesToExisting] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<AsyncState<PreviewBody>>({ status: "idle" });
  const [simulation, setSimulation] = React.useState<AsyncState<SimulationBody>>({ status: "idle" });
  const previewAbort = React.useRef<AbortController | null>(null);
  const simulationAbort = React.useRef<AbortController | null>(null);
  const valuesKey = JSON.stringify(draft.values);

  const runPreview = React.useCallback(async () => {
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    setPreview({ status: "loading" });
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, values: draft.values }), signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !body) setPreview({ status: "error", message: body?.error ?? "The preview could not be worked out." });
      else setPreview({ status: "ready", data: body as PreviewBody });
    } catch {
      if (!controller.signal.aborted) setPreview({ status: "error", message: "The preview could not be worked out. Check your connection and try again." });
    }
    // valuesKey keeps the callback tied to the exact draft values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, valuesKey]);

  React.useEffect(() => {
    void runPreview();
    setAppliesToExisting(false);
    setReviewed(false);
    setSimulation({ status: "idle" });
    return () => previewAbort.current?.abort();
  }, [runPreview]);

  React.useEffect(() => () => simulationAbort.current?.abort(), []);

  async function runSimulation() {
    simulationAbort.current?.abort();
    const controller = new AbortController();
    simulationAbort.current = controller;
    setSimulation({ status: "loading" });
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, values: draft.values }), signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !body) setSimulation({ status: "error", message: body?.error ?? "The test could not be run." });
      else setSimulation({ status: "ready", data: body as SimulationBody });
    } catch {
      if (!controller.signal.aborted) setSimulation({ status: "error", message: "The test could not be run. Check your connection and try again." });
    }
  }

  const existingCount = preview.status === "ready" ? preview.data.laundry.existingRunsReplanned + preview.data.jobs.existingTurnoversRetimed : 0;
  const reasonOk = reason.trim().length >= 8;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && effectiveFrom >= view.earliestEffectiveFrom;
  const canReview = reasonOk && dateOk && reviewed && preview.status === "ready" && !publishing && !view.coolDownUntil;
  const originLabel = draft.origin.kind === "RESTORE" ? `Restoring version ${draft.origin.restoredFromVersion}` : draft.origin.kind === "IMPORT" ? `Restoring ${draft.origin.label}` : "Your edit";

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Review before publishing</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{originLabel}, based on version {draft.baseVersion}. Nothing has been saved yet.</p>
      </ECardHeader>
      <ECardBody className="space-y-5">
        <section aria-labelledby="review-changes" className="space-y-2">
          <h2 id="review-changes" className="text-[0.9375rem] font-semibold">What will change ({changes.length})</h2>
          <ul className="space-y-1.5 text-[0.875rem]">
            {changes.map((change) => (
              <li key={change.key} className="break-words">
                <span className="font-medium">{titleOf(view, change.key)}</span>: {formatRuleValue(change.key, change.from)} → <strong>{formatRuleValue(change.key, change.to)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="review-preview" className="space-y-2">
          <h2 id="review-preview" className="text-[0.9375rem] font-semibold">What it affects (dry run, nothing saved)</h2>
          {preview.status === "loading" || preview.status === "idle" ? <p className="text-[0.8125rem]">Working out what would change…</p> : null}
          {preview.status === "error" ? (
            <EAlert tone="danger" title="Preview unavailable">
              {preview.message} <EButton variant="outline" size="sm" onClick={() => void runPreview()}>Try again</EButton>
            </EAlert>
          ) : null}
          {preview.status === "ready" ? (
            <div className="space-y-2 text-[0.875rem]">
              {preview.data.laundry.checked ? (
                <p>Laundry ({preview.data.laundry.properties} properties): <strong>{preview.data.laundry.newRunsChanged}</strong> upcoming new runs would be planned differently; <strong>{preview.data.laundry.existingRunsReplanned}</strong> existing pending runs would move only if you choose to re-plan them.</p>
              ) : null}
              {preview.data.jobs.checked ? (
                <p>Turnovers ({preview.data.jobs.futureTurnovers} upcoming): <strong>{preview.data.jobs.existingTurnoversRetimed}</strong> existing turnovers would get a new ready-by time only if you choose to re-plan them. New turnovers from the effective day follow the new time.</p>
              ) : null}
              {preview.data.recurring.checked ? (
                <p>Recurring jobs: tonight's run would create <strong>{preview.data.recurring.candidateWouldCreate}</strong> jobs instead of {preview.data.recurring.liveWouldCreate}.</p>
              ) : null}
              {preview.data.runTimeKeys.length ? <p>{preview.data.runTimeKeys.length} rule(s) are checked at each run and apply from the effective day.</p> : null}
              {[...preview.data.laundry.samples, ...preview.data.jobs.samples].length ? (
                <details className="rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] p-3">
                  <summary className="cursor-pointer font-medium">Examples</summary>
                  <ul className="mt-2 space-y-1 text-[0.8125rem]">
                    {preview.data.laundry.samples.map((sample, index) => <li key={`l${index}`} className="break-words">{sample.propertyName}, clean {sample.cleanDate}{sample.existing ? " (existing run)" : ""}: {sample.from} → {sample.to}</li>)}
                    {preview.data.jobs.samples.map((sample, index) => <li key={`j${index}`} className="break-words">{sample.propertyName}, {sample.date}: {sample.from} → {sample.to}</li>)}
                  </ul>
                </details>
              ) : null}
              {existingCount > 0 ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={appliesToExisting} disabled={publishing} onChange={(event) => setAppliesToExisting(event.target.checked)} />
                  <span>Re-plan these {existingCount} existing runs and jobs too. Left unticked, only new runs and jobs follow the new rules. Re-planned laundry still goes through the usual laundry review.</span>
                </label>
              ) : null}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="review-simulate" className="space-y-2">
          <h2 id="review-simulate" className="text-[0.9375rem] font-semibold">Test against last month</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Replays the last 30 days through the current and the new rules. Saves nothing.</p>
          <EButton variant="outline" size="sm" onClick={() => void runSimulation()} disabled={simulation.status === "loading" || publishing}>
            {simulation.status === "loading" ? "Testing…" : "Run the test"}
          </EButton>
          {simulation.status === "error" ? <EAlert tone="danger" title="Test unavailable">{simulation.message}</EAlert> : null}
          {simulation.status === "ready" ? (
            <div className="space-y-1 text-[0.875rem]">
              <p>{simulation.data.from} to {simulation.data.to}: {simulation.data.laundry.differ} of {simulation.data.laundry.cleans} cleans would have been planned differently; {simulation.data.jobs.differ} of {simulation.data.jobs.turnovers} turnovers would have had a different ready-by time.</p>
              {simulation.data.laundry.samples.length || simulation.data.jobs.samples.length ? (
                <ul className="space-y-1 text-[0.8125rem]">
                  {simulation.data.laundry.samples.map((sample, index) => <li key={`sl${index}`} className="break-words">{sample.propertyName}, {sample.cleanDate}: now {sample.current}; new {sample.candidate}{sample.actual ? `; actually ${sample.actual}` : ""}</li>)}
                  {simulation.data.jobs.samples.map((sample, index) => <li key={`sj${index}`} className="break-words">{sample.propertyName}, {sample.date}: {sample.current} → {sample.candidate}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Takes effect from" hint={`Earliest ${view.earliestEffectiveFrom} (tomorrow). Past and today's work is never re-planned.`}>
            <EInput type="date" min={view.earliestEffectiveFrom} value={effectiveFrom} disabled={publishing} onChange={(event) => setEffectiveFrom(event.target.value)} />
          </EField>
          <EField label="Why are the rules changing?" hint="Required, at least 8 characters. Kept in the version history.">
            <ETextarea value={reason} disabled={publishing} maxLength={1000} rows={3} onChange={(event) => setReason(event.target.value)} />
          </EField>
        </div>
        <label className="flex items-start gap-2 text-[0.875rem]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={reviewed} disabled={publishing || preview.status !== "ready"} onChange={(event) => setReviewed(event.target.checked)} />
          <span>I have checked what will change and what it affects.</span>
        </label>
        {view.coolDownUntil ? <EToneNotice tone="attention" title="Please wait">Rules were published in the last 10 minutes. You can publish again after {new Date(view.coolDownUntil).toLocaleTimeString()}.</EToneNotice> : null}
        {publishError ? <EAlert tone="danger" title="Not published">{publishError} Your draft is kept.</EAlert> : null}
        <div className="flex flex-wrap gap-2">
          <EButton variant="outline" onClick={onBack} disabled={publishing}>Back to editing</EButton>
          <EButton onClick={() => setConfirmOpen(true)} disabled={!canReview}>Publish…</EButton>
        </div>
      </ECardBody>
      <EConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Publish version ${view.latestVersion + 1}?`}
        description={`${changes.length} rule(s) change from ${effectiveFrom}. ${appliesToExisting ? `${existingCount} existing runs and jobs will be re-planned.` : "Existing runs and jobs keep their current rules."} A backup is taken first. Confirm with your own PIN.`}
        confirmLabel="Publish"
        requireSecurity
        danger={false}
        loading={publishing}
        onConfirm={async (credentials) => {
          if (!credentials) return;
          try {
            await onPublish({ effectiveFrom, reason: reason.trim(), appliesToExisting, credentials });
          } catch {
            // The reason is shown above the buttons; the draft and choices are kept.
          }
          setConfirmOpen(false);
        }}
      />
    </ECard>
  );
}
