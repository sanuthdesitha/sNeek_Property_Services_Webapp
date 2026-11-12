"use client";

/**
 * "Message team" on the admin job page (owner decision 2026-11-13).
 *
 * Addressed ONLY to the cleaners assigned to this job, shown by name; each
 * can be removed, nobody can be added. A short message (the office's text is
 * the body; the title comes from the wording layer, `job.office_message`),
 * and an explicit transport choice with the shared component (Inbox by
 * default, Push, SMS; each disabled with its reason; "Don't ask again"
 * respected). One request key per message: a failed send keeps the draft and
 * the key, so "Try again" is the same send and never a second one. Fields are
 * frozen while sending. The result lists each person and transport as
 * accepted, skipped or failed (never "delivered").
 * GET/POST /api/admin/jobs/[id]/office-message re-check everything.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { TransportChoice, chosenTransports, initialTransportChoice, type TransportCatalog, type TransportChoiceState } from "@/components/v2/admin/office-actions/transport-choice";
import {
  JOB_MESSAGE_STATE_LABEL,
  JOB_MESSAGE_TRANSPORTS,
  JOB_MESSAGE_TRANSPORT_DETAIL,
  JOB_MESSAGE_TRANSPORT_LABEL,
  type JobMessageOutcome,
  type JobMessageTransport,
} from "@/lib/notifications/job-office-message-rules";
import type { JobOfficeMessagePreview, JobOfficeMessageResult } from "@/lib/notifications/job-office-message";

export const JOB_MESSAGE_CATALOG: TransportCatalog<JobMessageTransport> = {
  kind: "job_office_message",
  order: JOB_MESSAGE_TRANSPORTS,
  label: JOB_MESSAGE_TRANSPORT_LABEL,
  detail: JOB_MESSAGE_TRANSPORT_DETAIL,
  first: "INBOX",
};

const OUTCOME_TRANSPORT: Record<JobMessageOutcome["transport"], string> = { INBOX: "Inbox", MOBILE_PUSH: "Phone alert", WEB_PUSH: "Browser alert", SMS: "SMS" };
const OUTCOME_TONE = { accepted: "ok", skipped: "warn", failed: "bad" } as const;

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: JobOfficeMessagePreview };
type Send = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: JobOfficeMessageResult };

function newKey(): string {
  return `jobmsg-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function isPreview(body: unknown): body is JobOfficeMessagePreview {
  return Boolean(body && typeof body === "object" && Array.isArray((body as { recipients?: unknown }).recipients) && "transports" in body);
}

export function MessageTeamDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [choice, setChoice] = useState<TransportChoiceState<JobMessageTransport>>({ transports: ["INBOX"], remember: false, usingSaved: false });
  const [send, setSend] = useState<Send>({ status: "idle" });
  const key = useRef(newKey());

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/office-message`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isPreview(json)) throw new Error((json as { error?: string } | null)?.error ?? `The team could not be loaded (${response.status}).`);
        setLoad({ status: "ready", preview: json });
        setChoice(initialTransportChoice(json, JOB_MESSAGE_CATALOG));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: reason instanceof Error ? reason.message : "The team could not be loaded." });
      });
    return () => controller.abort();
  }, [jobId]);

  const preview = load.status === "ready" ? load.preview : null;
  const recipients = preview ? preview.recipients.filter((recipient) => !removed.has(recipient.id)) : [];
  const transports = preview ? chosenTransports(choice, preview, JOB_MESSAGE_CATALOG) : [];
  const sending = send.status === "sending";
  const done = send.status === "done";
  const blocked = !body.trim() ? "Write a message first." : recipients.length === 0 ? "Keep at least one cleaner." : transports.length === 0 ? "Choose how to send it." : null;

  async function submit() {
    if (!preview || blocked) return;
    setSend({ status: "sending" });
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/office-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientIds: recipients.map((recipient) => recipient.id), body: body.trim(), transports, idempotencyKey: key.current, rememberTransports: choice.remember }),
      });
      const json = (await response.json().catch(() => null)) as (JobOfficeMessageResult & { error?: string }) | null;
      if (!response.ok || !json?.outcomes) {
        setSend({ status: "failed", message: json?.error ?? `The message was not sent (${response.status}). Your text is kept.` });
        return;
      }
      setSend({ status: "done", result: json });
    } catch {
      setSend({ status: "failed", message: "Could not reach the server. It may or may not have gone; Try again re-sends the SAME message, never a second one." });
    }
  }

  return (
    <EActionDialog
      open
      title="Message team"
      eyebrow={preview?.job.label}
      description="Only the cleaners assigned to this job. Remove anyone who should not get it."
      busy={sending}
      onClose={onClose}
      footer={
        done ? (
          <EButton size="sm" onClick={onClose}>Done</EButton>
        ) : (
          <>
            <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
            <EButton size="sm" disabled={!preview || sending || blocked !== null} title={blocked ?? undefined} onClick={() => void submit()}>
              {sending ? "Sending…" : send.status === "failed" ? "Try again" : `Send to ${recipients.length}`}
            </EButton>
          </>
        )
      }
    >
      {load.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading the team…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {preview && !done ? (
        <fieldset disabled={sending} className="flex flex-col gap-3 text-[0.8125rem]">
          <div>
            <p className="mb-1 font-[550]">To</p>
            <ul aria-label="Recipients" className="flex flex-wrap gap-1.5">
              {recipients.map((recipient) => (
                <li key={recipient.id} className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] py-0.5 pl-2.5 pr-1">
                  <span>{recipient.name}</span>
                  {!recipient.hasPhone ? <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">· no phone</span> : null}
                  <button type="button" aria-label={`Remove ${recipient.name}`} onClick={() => setRemoved((current) => new Set(current).add(recipient.id))} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[hsl(var(--e-muted))]">
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {removed.size > 0 ? <button type="button" className="mt-1 text-[0.75rem] underline" onClick={() => setRemoved(new Set())}>Put everyone back</button> : null}
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            They see the title &ldquo;{preview.title}&rdquo; above your message, linked to this job. <Link href="/v2/admin/notifications?type=job.office_message" className="underline">Edit the wording</Link>
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-[550]">Message</span>
            <textarea data-autofocus value={body} maxLength={preview.bodyMax} rows={4} onChange={(event) => setBody(event.target.value)} className="min-h-[6rem] rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2" />
            <span className="self-end text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{body.length} / {preview.bodyMax}</span>
          </label>
          <TransportChoice options={preview} value={choice} onChange={setChoice} disabled={sending} catalog={JOB_MESSAGE_CATALOG} />
        </fieldset>
      ) : null}
      {send.status === "failed" ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? <MessageResult result={send.result} /> : null}
    </EActionDialog>
  );
}

function MessageResult({ result }: { result: JobOfficeMessageResult }) {
  const people = Array.from(new Map(result.outcomes.map((outcome) => [outcome.userId, outcome.name])).entries());
  return (
    <div role="status" className="flex flex-col gap-2 text-[0.8125rem]">
      <p>{result.replayed ? "This message was already sent; nothing was sent again. What was recorded:" : "What each transport answered (accepted is not proof it was read):"}</p>
      <ul className="flex flex-col gap-1.5">
        {people.map(([userId, name]) => (
          <li key={userId}>
            <b className="font-[600]">{name}</b>
            <ul className="ml-3">
              {result.outcomes.filter((outcome) => outcome.userId === userId).map((outcome) => (
                <li key={outcome.transport} className="flex flex-wrap items-center gap-1.5">
                  <span>{OUTCOME_TRANSPORT[outcome.transport]}</span>
                  <EPill tone={OUTCOME_TONE[outcome.state]}>{JOB_MESSAGE_STATE_LABEL[outcome.state]}</EPill>
                  {outcome.reason ? <span className="text-[hsl(var(--e-muted-foreground))]">{outcome.reason}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {result.refused.length ? <p className="text-[hsl(var(--e-muted-foreground))]">Not sent to {result.refused.length}: no longer assigned to this job.</p> : null}
    </div>
  );
}
