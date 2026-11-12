"use client";

/**
 * Command "Send reminder" for an expiring document. Loads what will be sent
 * (the person, which contacts exist, the request title and wording, whether a
 * reminder already went today), lets the office choose the transports, then
 * calls REQUEST_DOCUMENT with the document id. The key is fixed while the
 * dialog is open, so a retry after "no answer" is the same request; the server
 * allows one reminder per document per day. Outcomes are the server's states.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import type { DocumentReminderPreview, DocumentReminderResult } from "@/lib/workforce/document-reminder";
import { newRequestKey, officeRequest } from "../office-actions/office-outcomes";
import { OfficeOutcomeList } from "../office-actions/outcome-list";

type Transport = "PUSH" | "EMAIL" | "SMS";
const LABEL: Record<Transport, string> = { PUSH: "In-app notice with phone and browser push", EMAIL: "Email", SMS: "SMS" };
const SMS_STATE: Record<string, string> = { provider_accepted: "Accepted by the provider", already_requested: "Already requested earlier", skipped: "Not sent (SMS switched off)", failed: "Failed" };

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: DocumentReminderPreview };
type Send = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: DocumentReminderResult };

export function DocumentReminderDialog({ documentId, endpoint, timeZone, onClose, onSent }: {
  documentId: string;
  endpoint: string;
  timeZone: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [transports, setTransports] = React.useState<Transport[]>(["PUSH"]);
  const [send, setSend] = React.useState<Send>({ status: "idle" });
  const [key] = React.useState(() => newRequestKey("docrem"));

  React.useEffect(() => {
    const controller = new AbortController();
    void officeRequest<DocumentReminderPreview>(`/api/admin/workforce/document-reminder?documentId=${encodeURIComponent(documentId)}`, { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || (!result.ok && result.aborted)) return;
      setLoad(result.ok ? { status: "ready", preview: result.body } : { status: "error", message: result.message });
    });
    return () => controller.abort();
  }, [documentId]);

  const preview = load.status === "ready" ? load.preview : null;
  const sending = send.status === "sending";
  const done = send.status === "done";
  const available = (transport: Transport) => transport === "PUSH" || (transport === "EMAIL" ? Boolean(preview?.person.hasEmail) : Boolean(preview?.person.hasPhone));
  const blocked = !preview || !preview.person.active || Boolean(preview.sentToday);

  async function submit() {
    setSend({ status: "sending" });
    const result = await officeRequest<{ ok: true; result: DocumentReminderResult }>(endpoint, {
      body: { action: "REQUEST_DOCUMENT", documentId, transports, idempotencyKey: key },
    });
    if (!result.ok) return setSend({ status: "failed", message: result.message });
    setSend({ status: "done", result: result.body.result });
    onSent();
  }

  return (
    <EActionDialog
      open
      busy={sending}
      onClose={onClose}
      eyebrow="Expiring document"
      title="Send reminder"
      footer={done ? <EButton size="sm" onClick={onClose}>Done</EButton> : (
        <>
          <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={sending || blocked || transports.length === 0} onClick={() => void submit()}>{sending ? "Sending…" : "Send reminder"}</EButton>
        </>
      )}
    >
      {load.status === "loading" ? <p role="status">Loading what will be sent…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {preview ? (
        <div className="space-y-3">
          <p>To: <b className="font-[600]">{preview.person.name}</b>{preview.expiresAt ? ` · ${preview.title} expires ${formatInTimeZone(new Date(preview.expiresAt), timeZone, "d MMM yyyy")}` : ""}</p>
          <p>A request for <b className="font-[600]">{preview.requestTitle}</b> appears in their team hub, due on the expiry date.</p>
          <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">{preview.wording}</p>
          {!preview.person.active ? <p role="note" className="text-[hsl(var(--e-danger))]">This account is not active, so no reminder can be sent.</p> : null}
          {preview.sentToday ? <p role="note" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2">A reminder for this document was already sent today at {formatInTimeZone(new Date(preview.sentToday.at), timeZone, "HH:mm")}. One reminder per document per day.</p> : null}
          {done ? null : (
            <fieldset disabled={sending || blocked} className="space-y-1.5">
              <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Send by</legend>
              {(["PUSH", "EMAIL", "SMS"] as const).map((transport) => (
                <label key={transport} className="flex items-start gap-2 text-[0.8125rem]">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    disabled={!available(transport)}
                    checked={transports.includes(transport)}
                    onChange={(event) => setTransports((current) => event.target.checked ? [...current, transport] : current.filter((item) => item !== transport))}
                  />
                  <span>{LABEL[transport]}{available(transport) ? "" : <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{transport === "EMAIL" ? "No email address recorded." : "No phone number recorded."}</span>}</span>
                </label>
              ))}
            </fieldset>
          )}
          {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
          {send.status === "done" ? (
            <div className="space-y-2">
              <p role="status">Requested. Each line is what that transport reported; none confirms the person has read it.</p>
              {send.result.delivery.outcomes.length > 0 ? <OfficeOutcomeList outcomes={send.result.delivery.outcomes} /> : null}
              {send.result.delivery.sms ? <EPill tone={send.result.delivery.sms.state === "provider_accepted" ? "ok" : send.result.delivery.sms.state === "failed" ? "bad" : "warn"}>SMS: {SMS_STATE[send.result.delivery.sms.state] ?? send.result.delivery.sms.state}</EPill> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </EActionDialog>
  );
}
