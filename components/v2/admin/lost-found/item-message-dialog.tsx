"use client";

/**
 * "Message guest" / "Tell client": a ready message the office can edit.
 *  - Guest, administrator: "Send by email" / "Send by text" go through the
 *    notification system's guest-message action; the item moves to Guest
 *    contacted only when the provider accepted it ("accepted", never
 *    "delivered"). One idempotency key per draft and transport, kept until it
 *    succeeds, so a retry is not a second message.
 *  - Client, administrator: "Send to client" through the pipeline's client
 *    notice (explicit transports; the timeline records the real states).
 *  - Otherwise (and always beside Send): copy, mailto:, sms:, tel:, then
 *    "Record that you contacted …", which stores what the office says it did.
 * The edited draft is kept by the panel while the dialog is closed.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { HydratedLostFoundItem } from "@/lib/lost-found/service";
import { CONTACT_CHANNELS, CONTACT_CHANNEL_LABEL, mailtoHref, smsHref, type ContactChannel, type MessageAudience, type MessageDraft } from "@/lib/lost-found/message";
import { ItemClientSend } from "./item-client-send";

type Recipient = { name: string | null; email: string | null; phone: string | null };
type Prepared = { draft: MessageDraft; recipient: Recipient; send: { available: boolean; reason: string } };
type SendResult = { outcome: { accepted: boolean; note: string }; item: HydratedLostFoundItem };
const SEND_LIMIT = 1000;
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; prepared: Prepared };

export type MessageDrafts = Partial<Record<MessageAudience, MessageDraft>>;

const NOTE_LIMIT = 4000;

function contactNote(channel: ContactChannel, officeNote: string, body: string): string {
  const head = `${CONTACT_CHANNEL_LABEL[channel]}.${officeNote.trim() ? ` ${officeNote.trim()}` : ""}`;
  const full = `${head}\n\nMessage used:\n${body}`;
  return full.length <= NOTE_LIMIT ? full : `${full.slice(0, NOTE_LIMIT - 1)}…`;
}

export function ItemMessageDialog({
  itemId,
  audience,
  onClose,
  drafts,
  onDraftChange,
  record,
  onSent,
}: {
  itemId: string;
  audience: MessageAudience | null;
  onClose: () => void;
  drafts: MessageDrafts;
  onDraftChange: (audience: MessageAudience, draft: MessageDraft) => void;
  record: (payload: Record<string, unknown>, success: string) => Promise<boolean>;
  /** Applies an item returned by a send (the panel updates and the list reloads). */
  onSent: (item: HydratedLostFoundItem) => void;
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [channel, setChannel] = React.useState<ContactChannel>("EMAIL");
  const [officeNote, setOfficeNote] = React.useState("");
  const [copied, setCopied] = React.useState<"idle" | "done" | "failed">("idle");
  const [saving, setSaving] = React.useState(false);
  const [sendResult, setSendResult] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const sendKeys = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    if (!audience) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    setCopied("idle");
    fetch(`/api/admin/lost-found/${itemId}/message?audience=${audience}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (Prepared & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.draft) throw new Error(body?.error ?? "Could not prepare the message.");
        setLoad({ status: "ready", prepared: body });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not prepare the message." });
      });
    return () => controller.abort();
  }, [itemId, audience]);

  if (!audience) return null;
  const prepared = load.status === "ready" ? load.prepared : null;
  const draft = drafts[audience] ?? prepared?.draft ?? null;
  const who = audience === "guest" ? "guest" : "client";

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  async function confirmContact() {
    if (!draft || !audience) return;
    setSaving(true);
    const ok = await record(
      { action: audience === "guest" ? "GUEST_CONTACTED" : "CLIENT_CONTACTED", channel, note: contactNote(channel, officeNote, draft.body) },
      audience === "guest" ? "Recorded: guest contacted" : "Recorded: client told",
    );
    setSaving(false);
    if (ok) {
      setOfficeNote("");
      onClose();
    }
  }

  async function sendFromApp(transport: "EMAIL" | "SMS") {
    if (!draft || !prepared) return;
    const to = transport === "EMAIL" ? prepared.recipient.email : prepared.recipient.phone;
    if (!to) return;
    const fingerprint = JSON.stringify([transport, to, draft.subject, draft.body]);
    const idempotencyKey = sendKeys.current.get(fingerprint) ?? `lf-${crypto.randomUUID()}`;
    sendKeys.current.set(fingerprint, idempotencyKey);
    setSaving(true);
    setSendResult(null);
    try {
      const response = await fetch(`/api/admin/lost-found/${itemId}/send-guest-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transport, to, subject: draft.subject, body: draft.body, idempotencyKey }),
      });
      const body = (await response.json().catch(() => null)) as (SendResult & { error?: string }) | null;
      if (!response.ok || !body?.outcome) throw new Error(body?.error ?? `The message was not sent (${response.status}).`);
      sendKeys.current.delete(fingerprint);
      setSendResult({ tone: body.outcome.accepted ? "ok" : "error", text: body.outcome.note });
      onSent(body.item);
    } catch (error) {
      setSendResult({ tone: "error", text: error instanceof Error ? error.message : "The message was not sent." });
    } finally {
      setSaving(false);
    }
  }

  const tooLongToSend = Boolean(draft && draft.body.length > SEND_LIMIT);
  const mailto = prepared && draft ? mailtoHref(prepared.recipient.email, draft) : null;
  const sms = prepared && draft ? smsHref(prepared.recipient.phone, draft) : null;

  return (
    <EModal open onClose={() => (saving ? undefined : onClose())} eyebrow="Lost and found" title={audience === "guest" ? "Message guest" : "Tell client"} size="wide">
      {load.status === "loading" ? <p role="status" className="py-6 text-center text-[0.875rem]">Preparing the message…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {prepared && draft ? (
        <div className="space-y-4">
          <p role="note" className={prepared.send.available ? "text-[0.8125rem] text-[hsl(var(--e-text-secondary))]" : "rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]"}>{prepared.send.reason}</p>
          <p className="text-[0.8125rem]">
            To: <span className="font-[600]">{prepared.recipient.name ?? `No ${who} name recorded`}</span>
            {" · "}{prepared.recipient.email ?? "no email"}{" · "}{prepared.recipient.phone ?? "no phone"}
          </p>
          <fieldset disabled={saving} className="space-y-3">
            <EField label="Subject"><EInput value={draft.subject} maxLength={300} onChange={(event) => onDraftChange(audience, { ...draft, subject: event.target.value })} /></EField>
            <EField label="Message"><ETextarea rows={10} value={draft.body} maxLength={3500} onChange={(event) => onDraftChange(audience, { ...draft, body: event.target.value })} /></EField>
            {prepared.send.available && audience === "client" ? (
              <ItemClientSend itemId={itemId} draft={draft} onSending={setSaving} onSent={onSent} />
            ) : null}
            {prepared.send.available && audience === "guest" ? (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-2">
                  <EButton type="button" size="sm" disabled={!prepared.recipient.email || tooLongToSend} onClick={() => void sendFromApp("EMAIL")}>Send by email</EButton>
                  <EButton type="button" size="sm" variant="outline" disabled={!prepared.recipient.phone || tooLongToSend} onClick={() => void sendFromApp("SMS")}>Send by text</EButton>
                </div>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {tooLongToSend ? `Shorten the message to ${SEND_LIMIT} characters to send it from the app (now ${draft.body.length}).` : !prepared.recipient.email && !prepared.recipient.phone ? "No guest email or phone recorded; edit the guest first." : `Up to ${SEND_LIMIT} characters.`}
                </p>
                {sendResult ? <p role={sendResult.tone === "error" ? "alert" : "status"} className={sendResult.tone === "error" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-success))]"}>{sendResult.text}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <EButton type="button" size="sm" variant="outline" onClick={() => void copy()}>Copy message</EButton>
              {mailto ? <EButton asChild size="sm" variant="outline"><a href={mailto}>Open in email</a></EButton> : null}
              {sms ? <EButton asChild size="sm" variant="outline"><a href={sms}>Open as text</a></EButton> : null}
              {prepared.recipient.phone ? <EButton asChild size="sm" variant="outline"><a href={`tel:${prepared.recipient.phone}`}>Call</a></EButton> : null}
            </div>
            <p aria-live="polite" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {copied === "done" ? "Copied." : copied === "failed" ? "Could not copy; select the message and copy it." : ""}
            </p>
            <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
              <p className="text-[0.8125rem] font-[600]">{prepared.send.available ? `Or record that you contacted the ${who} yourself` : `Record that you contacted the ${who}`}</p>
              <EField label="How">
                <ESelect value={channel} onChange={(event) => setChannel(event.target.value as ContactChannel)}>
                  {CONTACT_CHANNELS.map((value) => <option key={value} value={value}>{CONTACT_CHANNEL_LABEL[value]}</option>)}
                </ESelect>
              </EField>
              <EField label="Note (optional)"><EInput value={officeNote} maxLength={300} onChange={(event) => setOfficeNote(event.target.value)} placeholder="e.g. left a voicemail" /></EField>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {audience === "guest" ? "Records your note and the message on the timeline and moves the item to Guest contacted." : "Records your note and the message on the timeline. The status does not change."}
              </p>
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton size="sm" variant="outline" disabled={saving} onClick={onClose}>Close</EButton>
            <EButton size="sm" disabled={saving} onClick={() => void confirmContact()}>{saving ? "Recording…" : audience === "guest" ? "Mark guest contacted" : "Record client told"}</EButton>
          </div>
        </div>
      ) : null}
    </EModal>
  );
}
