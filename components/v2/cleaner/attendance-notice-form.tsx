"use client";

/**
 * "I can't attend" / "Running late" (pilot "Before-you-start extras"), from
 * the job's + menu before the cleaner clocks in. Tells the office at once
 * (inbox + phone push); the job and pay are unchanged until the office acts.
 * The draft and its request key survive a failed send; fields are frozen
 * while sending; one tap sends once.
 */
import * as React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { RUNNING_LATE_MINUTES_MAX, RUNNING_LATE_MINUTES_MIN, type AttendanceNoticeKind } from "@/lib/jobs/attendance-notice-rules";

type Draft = { reason: string; minutes: string; requestKey: string };

type SendState = { status: "idle" } | { status: "sending" } | { status: "sent"; inInbox: number } | { status: "failed"; message: string };

function newKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `attend-${random}`.slice(0, 60);
}

const LATE_CHOICES = [10, 20, 30, 45, 60];

export function AttendanceNoticeForm({ jobId, kind }: { jobId: string; kind: AttendanceNoticeKind }) {
  const [draft, setDraft] = React.useState<Draft>(() => ({ reason: "", minutes: kind === "RUNNING_LATE" ? "20" : "", requestKey: newKey() }));
  const [state, setState] = React.useState<SendState>({ status: "idle" });
  const sendingRef = React.useRef(false);
  const ids = React.useId();

  React.useEffect(() => {
    setDraft({ reason: "", minutes: kind === "RUNNING_LATE" ? "20" : "", requestKey: newKey() });
    setState({ status: "idle" });
  }, [jobId, kind]);

  async function send() {
    if (sendingRef.current) return;
    const reason = draft.reason.trim();
    const minutes = Number(draft.minutes);
    if (reason.length < 3) return setState({ status: "failed", message: "Give a short reason." });
    if (kind === "RUNNING_LATE" && (!Number.isInteger(minutes) || minutes < RUNNING_LATE_MINUTES_MIN || minutes > RUNNING_LATE_MINUTES_MAX)) {
      return setState({ status: "failed", message: `Minutes late: ${RUNNING_LATE_MINUTES_MIN} to ${RUNNING_LATE_MINUTES_MAX}.` });
    }
    sendingRef.current = true;
    setState({ status: "sending" });
    try {
      const res = await fetch(`/api/cleaner/jobs/${encodeURIComponent(jobId)}/attendance-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "RUNNING_LATE" ? { kind, requestKey: draft.requestKey, reason, minutes } : { kind, requestKey: draft.requestKey, reason }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; office?: { inInbox?: number } } | null;
      if (!res.ok) {
        setState({ status: "failed", message: body?.error ?? "Not sent. Your note is kept; try again or call the office." });
        return;
      }
      setState({ status: "sent", inInbox: body?.office?.inInbox ?? 0 });
    } catch {
      setState({ status: "failed", message: "No connection. Not sent; your note is kept. Call the office if it is urgent." });
    } finally {
      sendingRef.current = false;
    }
  }

  if (state.status === "sent") {
    return (
      <p role="status" className={`flex items-start gap-2 rounded-[var(--e-radius)] ${toneNoticeClass("good")} p-3 text-[0.8125rem]`}>
        <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        {state.inInbox > 0 ? "Sent. The office has it in their inbox." : "Sent to the office. It may take a moment to reach their inbox."} The job stays as it is until the office changes it.
      </p>
    );
  }
  const sending = state.status === "sending";
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        {kind === "CANT_ATTEND"
          ? "The office is told now and decides what happens to the job. You stay on it until they change it."
          : "The office is told now. The client is not messaged by this."}
      </p>
      {kind === "RUNNING_LATE" ? (
        <fieldset disabled={sending} className="space-y-1">
          <legend className="text-[0.75rem] font-[600]">About how many minutes late?</legend>
          <div className="flex flex-wrap gap-2">
            {LATE_CHOICES.map((choice) => (
              <EButton key={choice} size="sm" variant={draft.minutes === String(choice) ? "gold" : "outline"} aria-pressed={draft.minutes === String(choice)} onClick={() => setDraft((previous) => ({ ...previous, minutes: String(choice) }))}>
                {choice} min
              </EButton>
            ))}
          </div>
          <label htmlFor={`${ids}-minutes`} className="block pt-1 text-[0.75rem]">
            Other (minutes)
            <input
              id={`${ids}-minutes`}
              inputMode="numeric"
              value={draft.minutes}
              onChange={(event) => setDraft((previous) => ({ ...previous, minutes: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) }))}
              className="mt-1 h-10 w-28 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2 text-[16px] sm:text-[0.8125rem]"
            />
          </label>
        </fieldset>
      ) : null}
      <label htmlFor={`${ids}-reason`} className="block text-[0.75rem] font-[600]">
        Reason (required)
        <textarea
          id={`${ids}-reason`}
          rows={3}
          maxLength={500}
          disabled={sending}
          value={draft.reason}
          onChange={(event) => setDraft((previous) => ({ ...previous, reason: event.target.value }))}
          className="mt-1 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-2 text-[16px] font-normal sm:text-[0.8125rem]"
        />
      </label>
      {state.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{state.message}</p> : null}
      <EButton variant="gold" size="md" disabled={sending} onClick={() => void send()}>
        {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null} Tell the office
      </EButton>
    </div>
  );
}
