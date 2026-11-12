"use client";

/**
 * Live ops "Pause clock" for a cleaner off site with the clock running (owner
 * decision, third set item 3). ADMIN, or OPS_MANAGER with the Jobs pack at
 * manage (owner decision 2026-11-12), like its route
 * (POST /api/admin/jobs/[id]/pause-clock). The dialog says exactly what
 * happens, asks for the required reason and which transports tell the
 * cleaner, freezes while the request runs, keeps the reason on failure and
 * shows the server's answer: when the log was closed, the minutes it holds,
 * the job status after, and the notice's real states.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { LiveJobRow } from "@/lib/ops/live-board-types";
import type { ClockPauseResult } from "@/lib/jobs/admin-clock-pause";
import { TRANSPORT_CHOICE_LABELS, officeRequest, type OfficeTransportChoice } from "../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../office-actions/outcome-list";

const CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];

type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: ClockPauseResult };

type Props = { job: LiveJobRow | null; timeZone: string; onClose: () => void; onPaused: () => void };

export function pauseClockEndpoint(jobId: string): string {
  return `/api/admin/jobs/${encodeURIComponent(jobId)}/pause-clock`;
}

export function PauseClockDialog({ job, timeZone, onClose, onPaused }: Props) {
  const reasonId = React.useId();
  const cleanerId = React.useId();
  const clocks = job?.runningClocks ?? [];
  const [cleaner, setCleaner] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [transports, setTransports] = React.useState<OfficeTransportChoice[]>(["PUSH"]);
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const jobId = job?.jobId ?? null;

  // A different job starts a fresh form.
  React.useEffect(() => {
    setCleaner(job?.runningClocks?.[0]?.userId ?? "");
    setReason("");
    setTransports(["PUSH"]);
    setSend({ status: "idle" });
    // Only when the job changes, not on every board refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const sending = send.status === "sending";
  const done = send.status === "done";
  const name = clocks.find((clock) => clock.userId === cleaner)?.name ?? "the cleaner";
  const canSend = Boolean(jobId && cleaner) && reason.trim().length >= 3 && transports.length > 0 && !sending && !done;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!jobId || !canSend) return;
    setSend({ status: "sending" });
    const result = await officeRequest<ClockPauseResult>(pauseClockEndpoint(jobId), { body: { cleanerId: cleaner, reason: reason.trim(), transports } });
    if (result.ok) {
      setSend({ status: "done", result: result.body });
      onPaused();
    } else setSend({ status: "failed", message: result.message });
  }

  const formId = `${reasonId}-form`;
  const footer = done ? (
    <EButton size="sm" onClick={onClose}>Done</EButton>
  ) : (
    <>
      <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
      <EButton type="submit" form={formId} size="sm" disabled={!canSend}>{sending ? "Pausing…" : "Pause clock"}</EButton>
    </>
  );

  return (
    <EActionDialog
      open={Boolean(job)}
      busy={sending}
      onClose={onClose}
      eyebrow="Off site, clock running"
      title={`Pause ${name}'s clock`}
      footer={footer}
      description={
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Closes their running clock on this job at the moment you confirm. Time already recorded is kept; nothing is deleted.</li>
          <li>If the job is in progress it becomes Paused, exactly as when the cleaner pauses it.</li>
          <li>They are told, with your reason, and can carry on with Resume clock on their job screen.</li>
        </ul>
      }
    >
      {done ? null : (
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-3">
          <fieldset disabled={sending} className="space-y-3">
            {clocks.length > 1 ? (
              <div className="space-y-1">
                <label htmlFor={cleanerId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Cleaner</label>
                <ESelect id={cleanerId} value={cleaner} onChange={(event) => setCleaner(event.target.value)}>
                  {clocks.map((clock) => <option key={clock.timeLogId} value={clock.userId}>{clock.name}</option>)}
                </ESelect>
              </div>
            ) : null}
            <div className="space-y-1">
              <label htmlFor={reasonId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Reason (required, the cleaner sees it)</label>
              <ETextarea id={reasonId} data-autofocus rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. You left the property at 11:40 with the clock running." />
            </div>
            <TransportChoices choices={CHOICES} value={transports} labels={TRANSPORT_CHOICE_LABELS} onChange={setTransports} legend="Tell the cleaner by" />
          </fieldset>
          {clocks.length === 0 ? <p role="alert" className="text-[hsl(var(--e-danger))]">No running clock is shown for this job any more.</p> : null}
        </form>
      )}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? (
        <div className="space-y-2" role="status">
          <p>
            Paused at {formatInTimeZone(new Date(send.result.stoppedAt), timeZone, "HH:mm")}. This clock segment holds {send.result.durationM} min.
            Job status now: {send.result.jobStatus.replace(/_/g, " ").toLowerCase() || "unknown"}.
          </p>
          {send.result.noticeError ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.result.noticeError}</p> : <OfficeOutcomeList outcomes={send.result.notice} />}
        </div>
      ) : null}
    </EActionDialog>
  );
}
