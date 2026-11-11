"use client";

/**
 * Live ops "Notify client" for a late job (owner decision, third set item 2).
 *
 * Opens with the server's preview: the client logins it would reach, the exact
 * wording (the send's own function, with the real ETA in minutes when the
 * cleaner gave one), transports switched off in Notifications, and the send's
 * refusal when it would refuse (e.g. the client switched notifications off).
 * The send is the existing client delay notice route (ADMIN only) with an
 * idempotency key: the first notice of the day for a job uses a fixed key, so
 * a double click or a retry after "no answer" is the same request; when a
 * notice was already requested today the dialog says so and only an explicit
 * "Send another" (a fresh key) sends again. Results are the transports' real
 * states, never "sent" or "delivered".
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import type { ClientDelayPreview } from "@/lib/notifications/client-delay-preview";
import type { LiveJobRow } from "@/lib/ops/live-board-types";
import { TRANSPORT_CHOICE_LABELS, newRequestKey, officeRequest, type OfficeActionResult, type OfficeTransportChoice } from "../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../office-actions/outcome-list";

const CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];
export const DELAY_NOTICE_ENDPOINT = "/api/admin/notifications/actions/client-delay";

/** Whole minutes from now to the projected arrival, within the route's 1–600; null when unknown or passed. */
export function etaMinutesFrom(etaAt: string | null | undefined, nowMs: number): number | null {
  if (!etaAt) return null;
  const at = Date.parse(etaAt);
  if (Number.isNaN(at)) return null;
  const minutes = Math.ceil((at - nowMs) / 60_000);
  return minutes >= 1 ? Math.min(600, minutes) : null;
}

/** The fixed key for the first notice of the day for a job. */
export function firstNoticeKey(jobId: string, todayKey: string): string {
  return `delay:${jobId}:${todayKey}`.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
}

type PreviewState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: ClientDelayPreview };
type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: OfficeActionResult };

type Props = {
  job: LiveJobRow | null;
  todayKey: string;
  timeZone: string;
  onClose: () => void;
  onRequested: () => void;
};

function clock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatInTimeZone(date, timeZone, "HH:mm");
}

export function DelayNoticeDialog({ job, todayKey, timeZone, onClose, onRequested }: Props) {
  const [preview, setPreview] = React.useState<PreviewState>({ status: "loading" });
  const [transports, setTransports] = React.useState<OfficeTransportChoice[]>(["PUSH", "EMAIL"]);
  const [another, setAnother] = React.useState(false);
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const [requestKey, setRequestKey] = React.useState("");
  const jobId = job?.jobId ?? null;

  React.useEffect(() => {
    if (!jobId || !job) return;
    const controller = new AbortController();
    const eta = etaMinutesFrom(job.etaAt, Date.now());
    setPreview({ status: "loading" });
    setSend({ status: "idle" });
    setAnother(false);
    setTransports(["PUSH", "EMAIL"]);
    setRequestKey(firstNoticeKey(jobId, todayKey));
    const query = new URLSearchParams({ jobId, ...(eta ? { etaMinutes: String(eta) } : {}) });
    void officeRequest<ClientDelayPreview>(`${DELAY_NOTICE_ENDPOINT}?${query.toString()}`, { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && result.body.jobId === jobId) setPreview({ status: "ready", preview: result.body });
      else if (!result.ok && !result.aborted) setPreview({ status: "error", message: result.message });
    });
    return () => controller.abort();
    // The preview is read once per opened job; later board refreshes do not re-read it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, todayKey]);

  const ready = preview.status === "ready" ? preview.preview : null;
  const earlier = ready?.lastRequest ?? job?.delayNotice ?? null;
  const sending = send.status === "sending";
  const done = send.status === "done";
  const blocked = ready?.blocked ?? null;
  const canSend = Boolean(ready) && !blocked && transports.length > 0 && (!earlier || another) && !sending && !done;

  function toggleAnother(checked: boolean) {
    setAnother(checked);
    // "Send another" is a new request: it gets its own key.
    setRequestKey(checked ? newRequestKey("delay-again") : firstNoticeKey(jobId ?? "", todayKey));
  }

  async function submit() {
    if (!ready || !jobId || !canSend) return;
    setSend({ status: "sending" });
    const result = await officeRequest<OfficeActionResult>(DELAY_NOTICE_ENDPOINT, {
      body: { jobId, transports, idempotencyKey: requestKey, ...(ready.etaMinutes ? { etaMinutes: ready.etaMinutes } : {}) },
    });
    if (result.ok) {
      setSend({ status: "done", result: result.body });
      onRequested();
    } else setSend({ status: "failed", message: result.message });
  }

  const footer = done ? (
    <EButton size="sm" onClick={onClose}>Close</EButton>
  ) : (
    <>
      <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
      <EButton size="sm" disabled={!canSend} onClick={() => void submit()}>{sending ? "Requesting…" : earlier ? "Send another" : "Notify client"}</EButton>
    </>
  );

  return (
    <EActionDialog open={Boolean(job)} busy={sending} onClose={onClose} eyebrow="Late job" title="Notify the client of the delay" footer={footer}>
      {preview.status === "loading" ? <p role="status" className="text-[hsl(var(--e-muted-foreground))]">Checking who would be told…</p> : null}
      {preview.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{preview.message}</p> : null}
      {ready ? (
        <>
          <div className="space-y-1">
            <p className="e-eyebrow">To</p>
            {ready.recipients.length ? (
              <ul className="space-y-0.5">
                {ready.recipients.map((person) => <li key={person.id} className="[overflow-wrap:anywhere]">{person.name}{person.email ? ` · ${person.email}` : " · no email address"}</li>)}
              </ul>
            ) : <p className="text-[hsl(var(--e-muted-foreground))]">Nobody can be told.</p>}
          </div>
          <div className="space-y-1">
            <p className="e-eyebrow">Message</p>
            <p className="font-[600]">{ready.subject}</p>
            <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">{ready.body}</p>
            {!ready.etaMinutes ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No ETA from the cleaner, so no time is given.</p> : null}
          </div>
          {blocked ? <p role="alert" className="text-[hsl(var(--e-danger))]">Not sent: {blocked}</p> : null}
          {!blocked && !done ? (
            <TransportChoices choices={CHOICES} value={transports} labels={TRANSPORT_CHOICE_LABELS} disabled={sending} onChange={setTransports} />
          ) : null}
          {ready.switchedOff.length ? <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">Switched off for this notice in Notifications: {ready.switchedOff.join(", ").toLowerCase().replace(/_/g, " ")}.</p> : null}
          {earlier && !done ? (
            <div role="status" className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning-soft))] px-3 py-2">
              <p>Already requested at {clock(earlier.at, timeZone)} by {earlier.byName}.</p>
              <label className="flex items-center gap-2 text-[0.8125rem]">
                <input type="checkbox" className="h-4 w-4" checked={another} disabled={sending} onChange={(event) => toggleAnother(event.target.checked)} />
                Send another notice
              </label>
            </div>
          ) : null}
        </>
      ) : null}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? (
        <div className="space-y-2">
          <p role="status">Requested. Each line is what that transport reported; none of them confirms the client has read it.</p>
          <OfficeOutcomeList outcomes={send.result.outcomes} refused={send.result.refused} />
        </div>
      ) : null}
    </EActionDialog>
  );
}
