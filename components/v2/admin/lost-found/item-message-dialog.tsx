"use client";

/**
 * "Message guest" / "Tell client": a ready message the office can edit, then
 * send from its own email or SMS app (copy, mailto:, sms:, tel:). The app's
 * notification pipeline cannot send to a guest or to a client for lost and
 * found today, so the dialog says so and never claims a message was sent.
 * "Record that you contacted …" stores what the office says it did; only the
 * guest record moves the item to Guest contacted. The edited draft is kept by
 * the panel while the dialog is closed.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { CONTACT_CHANNELS, CONTACT_CHANNEL_LABEL, mailtoHref, smsHref, type ContactChannel, type MessageAudience, type MessageDraft } from "@/lib/lost-found/message";

type Recipient = { name: string | null; email: string | null; phone: string | null };
type Prepared = { draft: MessageDraft; recipient: Recipient; send: { available: boolean; reason: string } };
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
}: {
  itemId: string;
  audience: MessageAudience | null;
  onClose: () => void;
  drafts: MessageDrafts;
  onDraftChange: (audience: MessageAudience, draft: MessageDraft) => void;
  record: (payload: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [channel, setChannel] = React.useState<ContactChannel>("EMAIL");
  const [officeNote, setOfficeNote] = React.useState("");
  const [copied, setCopied] = React.useState<"idle" | "done" | "failed">("idle");
  const [saving, setSaving] = React.useState(false);

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

  const mailto = prepared && draft ? mailtoHref(prepared.recipient.email, draft) : null;
  const sms = prepared && draft ? smsHref(prepared.recipient.phone, draft) : null;

  return (
    <EModal open onClose={() => (saving ? undefined : onClose())} eyebrow="Lost and found" title={audience === "guest" ? "Message guest" : "Tell client"} size="wide">
      {load.status === "loading" ? <p role="status" className="py-6 text-center text-[0.875rem]">Preparing the message…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {prepared && draft ? (
        <div className="space-y-4">
          <p role="note" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">{prepared.send.reason}</p>
          <p className="text-[0.8125rem]">
            To: <span className="font-[600]">{prepared.recipient.name ?? `No ${who} name recorded`}</span>
            {" · "}{prepared.recipient.email ?? "no email"}{" · "}{prepared.recipient.phone ?? "no phone"}
          </p>
          <fieldset disabled={saving} className="space-y-3">
            <EField label="Subject"><EInput value={draft.subject} maxLength={300} onChange={(event) => onDraftChange(audience, { ...draft, subject: event.target.value })} /></EField>
            <EField label="Message"><ETextarea rows={10} value={draft.body} maxLength={3500} onChange={(event) => onDraftChange(audience, { ...draft, body: event.target.value })} /></EField>
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
              <p className="text-[0.8125rem] font-[600]">Record that you contacted the {who}</p>
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
