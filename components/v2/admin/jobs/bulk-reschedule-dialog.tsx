"use client";

/**
 * Bulk Reschedule for selected jobs, through ONE endpoint
 * (`POST /api/admin/jobs/bulk-reschedule`):
 *
 *   choose a date and optional time shift → preview (the Calendar's move check
 *   for every job: clash, not movable, booking-driven notice) → confirm →
 *   apply (each movable job re-checked and saved by the existing reschedule
 *   service) → a result per row.
 *
 * Fields are frozen while a request runs; changing them after a preview
 * discards it (a preview only answers the inputs it was asked). Jobs that were
 * not moved stay selected on the page.
 */
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { mediumDayLabel } from "@/lib/calendar/range";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import type { BulkApplyRow, BulkPreviewRow } from "@/lib/jobs/bulk-reschedule";
import { JobDialog } from "./job-dialog";

const FIELD = "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] disabled:opacity-60";
const SHIFTS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Keep each job's times" },
  { value: -120, label: "2 hours earlier" }, { value: -60, label: "1 hour earlier" },
  { value: -30, label: "30 minutes earlier" }, { value: -15, label: "15 minutes earlier" },
  { value: 15, label: "15 minutes later" }, { value: 30, label: "30 minutes later" },
  { value: 60, label: "1 hour later" }, { value: 120, label: "2 hours later" },
];
const OUTCOME_TONE = { moved: "ok", refused: "warn", failed: "bad" } as const;
const OUTCOME_LABEL = { moved: "Moved", refused: "Not moved", failed: "Failed" } as const;

type Stage =
  | { kind: "form" }
  | { kind: "preview"; rows: BulkPreviewRow[] }
  | { kind: "results"; rows: BulkApplyRow[] };

type DialogProps = {
  open: boolean;
  jobIds: string[];
  onClose: () => void;
  /** Called with the ids that were NOT moved (they stay selected). */
  onFinished: (notMoved: string[]) => void;
};

async function post(body: unknown, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch("/api/admin/jobs/bulk-reschedule", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const parsed: unknown = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {} };
}

export function BulkRescheduleDialog({ open, jobIds, onClose, onFinished }: DialogProps) {
  const [date, setDate] = useState("");
  const [shift, setShift] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController | null>(null);
  const selectionKey = jobIds.join(",");

  // A new opening starts again.
  useEffect(() => {
    inFlight.current?.abort();
    setStage({ kind: "form" }); setError(""); setBusy(false);
    if (open) setDate((current) => current || sydneyTodayKey());
  }, [open]);
  // A preview answers one selection; a different selection needs a new one.
  // (Results stay: the page narrows the selection to unmoved jobs after apply.)
  useEffect(() => {
    setStage((current) => (current.kind === "preview" ? { kind: "form" } : current));
  }, [selectionKey]);
  useEffect(() => () => inFlight.current?.abort(), []);

  async function run(mode: "preview" | "apply") {
    if (busy || jobIds.length === 0 || !date) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true); setError("");
    const expectedUpdatedAt = stage.kind === "preview"
      ? Object.fromEntries(stage.rows.filter((row) => row.movable && row.expectedUpdatedAt).map((row) => [row.jobId, row.expectedUpdatedAt as string]))
      : undefined;
    const ids = mode === "apply" && stage.kind === "preview" ? stage.rows.filter((row) => row.movable).map((row) => row.jobId) : jobIds;
    try {
      const result = await post({ mode, jobIds: ids, toDate: date, ...(shift ? { shiftMinutes: shift } : {}), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(typeof result.body.error === "string" ? result.body.error : `The request failed (${result.status}). Nothing was changed.`);
        return;
      }
      if (mode === "preview" && Array.isArray(result.body.rows)) {
        setStage({ kind: "preview", rows: result.body.rows as BulkPreviewRow[] });
        return;
      }
      if (mode === "apply" && Array.isArray(result.body.results)) {
        const rows = result.body.results as BulkApplyRow[];
        setStage({ kind: "results", rows });
        const moved = new Set(rows.filter((row) => row.outcome === "moved").map((row) => row.jobId));
        onFinished(jobIds.filter((id) => !moved.has(id)));
        return;
      }
      setError("The server returned an unexpected answer. Reload the jobs to see what changed.");
    } catch {
      if (!controller.signal.aborted) {
        setError(mode === "apply"
          ? "The connection failed during the save. Reload the jobs to see which moved before trying again."
          : "The preview could not be loaded. Nothing was changed.");
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }

  const movable = stage.kind === "preview" ? stage.rows.filter((row) => row.movable).length : 0;
  const changeInputs = (apply: () => void) => {
    apply();
    if (stage.kind === "preview") setStage({ kind: "form" });
  };

  return (
    <JobDialog open={open} title="Reschedule jobs" busy={busy} onClose={onClose}>
      <div className="space-y-4 text-[0.8125rem]">
        {stage.kind !== "results" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">New date</span>
              <input type="date" aria-label="New date" className={FIELD} value={date} disabled={busy}
                onChange={(event) => changeInputs(() => setDate(event.target.value))} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Time</span>
              <select aria-label="Time shift" className={FIELD} value={shift} disabled={busy}
                onChange={(event) => changeInputs(() => setShift(Number(event.target.value)))}>
                {SHIFTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        {stage.kind === "form" ? (
          <p>Each of the {jobIds.length} selected job{jobIds.length === 1 ? "" : "s"} is checked the way a Calendar move is: started or finished work, clashes and roster gaps on the new day, and booking-driven turnovers. Nothing changes until you confirm.</p>
        ) : null}

        {stage.kind === "preview" ? <PreviewList rows={stage.rows} /> : null}
        {stage.kind === "results" ? <ResultList rows={stage.rows} /> : null}
        {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          {stage.kind === "results" ? <EButton onClick={onClose}>Done</EButton> : (
            <>
              <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
              {stage.kind === "form" ? (
                <EButton onClick={() => void run("preview")} disabled={busy || !date}>{busy ? "Checking…" : "Check jobs"}</EButton>
              ) : (
                <EButton onClick={() => void run("apply")} disabled={busy || movable === 0}>
                  {busy ? "Rescheduling…" : `Reschedule ${movable} job${movable === 1 ? "" : "s"}`}
                </EButton>
              )}
            </>
          )}
        </div>
      </div>
    </JobDialog>
  );
}

function PreviewList({ rows }: { rows: BulkPreviewRow[] }) {
  const movable = rows.filter((row) => row.movable).length;
  return (
    <>
      <p role="status">{movable} of {rows.length} can move{rows.length - movable ? `; ${rows.length - movable} cannot and will stay selected` : ""}. Moving notifies the assigned cleaners and sends the client&rsquo;s schedule-update email when that is switched on.</p>
      <ul aria-label="Reschedule preview" className="max-h-72 space-y-2 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.jobId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-[600]">{row.propertyName}</span>
              <EPill tone={row.movable ? "ok" : "bad"}>{row.movable ? "Can move" : "Not movable"}</EPill>
            </div>
            <p className="e-tnum mt-1 text-[hsl(var(--e-muted-foreground))]">
              {row.fromDate ? mediumDayLabel(row.fromDate) : "—"} → {mediumDayLabel(row.toDate)}
              {row.time ? ` · ${row.time.fromStart ?? "no start"} → ${row.time.toStart}` : ""}
            </p>
            {row.blockers.map((text) => <p key={text} className="mt-1 text-[hsl(var(--e-danger))]">{text}</p>)}
            {row.warnings.map((warning) => (
              <p key={`${warning.kind}:${warning.text}`} className="mt-1 text-[hsl(var(--e-warning))]">
                <span className="font-[600]">{warning.kind === "booking" ? "Booking" : warning.kind === "clash" ? "Clash" : "Roster"}:</span> {warning.text}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

function ResultList({ rows }: { rows: BulkApplyRow[] }) {
  const moved = rows.filter((row) => row.outcome === "moved").length;
  return (
    <>
      <p role="status">{moved} of {rows.length} rescheduled. Jobs that did not move stay selected.</p>
      <ul aria-label="Reschedule results" className="max-h-72 space-y-2 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.jobId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-[600]">{row.propertyName}</span>
              <EPill tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</EPill>
            </div>
            {row.outcome !== "moved" ? <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">{row.message}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
