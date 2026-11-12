"use client";

/**
 * Command "Send reminder" for an expiring document. Loads what will be sent
 * (the person, which contacts exist, the request title and wording, whether a
 * reminder already went today), lets the office choose the transports with
 * the shared "Send by" choice (Inbox / Email / SMS, "Don't ask again" for this
 * office user, the same component and saved choice as Accounts "Request
 * document"), then calls REQUEST_DOCUMENT with the document id and the
 * explicit transports. The key is fixed while the
 * dialog is open, so a retry after "no answer" is the same request; the server
 * allows one reminder per document per day. Outcomes are the server's states.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import type { DocumentReminderPreview, DocumentReminderResult } from "@/lib/workforce/document-reminder";
import type { DocumentRequestOptions } from "@/lib/workforce/document-request-transports";
import { newRequestKey, officeRequest } from "../office-actions/office-outcomes";
import { DocumentRequestDeliveryView } from "../office-actions/document-request-delivery";
import { TransportChoice, chosenTransports, initialTransportChoice, type TransportChoiceState } from "../office-actions/transport-choice";

type ReminderPreview = DocumentReminderPreview & { options: DocumentRequestOptions };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: ReminderPreview };
type Send = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: DocumentReminderResult };

export function DocumentReminderDialog({ documentId, endpoint, timeZone, onClose, onSent }: {
  documentId: string;
  endpoint: string;
  timeZone: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [choice, setChoice] = React.useState<TransportChoiceState | null>(null);
  const [send, setSend] = React.useState<Send>({ status: "idle" });
  const [key] = React.useState(() => newRequestKey("docrem"));

  React.useEffect(() => {
    const controller = new AbortController();
    void officeRequest<ReminderPreview>(`/api/admin/workforce/document-reminder?documentId=${encodeURIComponent(documentId)}`, { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || (!result.ok && result.aborted)) return;
      if (!result.ok) return setLoad({ status: "error", message: result.message });
      setLoad({ status: "ready", preview: result.body });
      setChoice(initialTransportChoice(result.body.options));
    });
    return () => controller.abort();
  }, [documentId]);

  const preview = load.status === "ready" ? load.preview : null;
  const sending = send.status === "sending";
  const done = send.status === "done";
  const transports = preview && choice ? chosenTransports(choice, preview.options) : [];
  const blocked = !preview || !preview.person.active || Boolean(preview.sentToday) || preview.options.impersonating;

  async function submit() {
    if (!choice || transports.length === 0) return;
    setSend({ status: "sending" });
    const result = await officeRequest<{ ok: true; result: DocumentReminderResult }>(endpoint, {
      body: { action: "REQUEST_DOCUMENT", documentId, transports, rememberTransports: choice.remember && !choice.usingSaved, idempotencyKey: key },
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
          {preview.options.impersonating ? <p role="note" className="text-[hsl(var(--e-danger))]">Reminders cannot be sent while impersonating.</p> : null}
          {done || !choice ? null : (
            <TransportChoice options={preview.options} value={choice} onChange={setChoice} disabled={sending || blocked} />
          )}
          {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
          {send.status === "done" ? <DocumentRequestDeliveryView delivery={send.result.delivery} noun="reminder" /> : null}
        </div>
      ) : null}
    </EActionDialog>
  );
}
