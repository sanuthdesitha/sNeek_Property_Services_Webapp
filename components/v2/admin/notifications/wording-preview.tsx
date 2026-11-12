"use client";

import type { WordingFields } from "@/lib/notifications/wording/types";
import type { WordingPartView } from "@/lib/notifications/wording/view-types";
import { draftKey, htmlToText, previewPart } from "./wording-model";

type Props = {
  parts: WordingPartView[];
  drafts: Record<string, WordingFields>;
  companyName: string;
};

/** The main (non-line) part of a transport: what the preview shows. */
function mainPart(parts: WordingPartView[], transport: WordingPartView["transport"]): WordingPartView | undefined {
  return parts.find((part) => part.transport === transport && part.fields.length > 1) ?? parts.find((part) => part.transport === transport && transport === "SMS");
}

/**
 * Live preview with sample data (never real people): the SMS on a phone, the
 * email in a frame and the inbox row, each from the draft being edited.
 * The email body is shown in a sandboxed frame (no scripts run).
 */
export function WordingPreview({ parts, drafts, companyName }: Props) {
  const fieldsOf = (part: WordingPartView) => drafts[draftKey(part)] ?? part.live;
  const sms = mainPart(parts, "SMS");
  const email = mainPart(parts, "EMAIL");
  const inbox = mainPart(parts, "INBOX") ?? mainPart(parts, "PUSH");
  const smsPreview = sms ? previewPart(sms, fieldsOf(sms)) : null;
  const emailPreview = email ? previewPart(email, fieldsOf(email)) : null;
  const inboxPreview = inbox ? previewPart(inbox, fieldsOf(inbox)) : null;

  if (!sms && !email && !inbox) return <p className="text-sm text-[hsl(var(--e-muted-foreground))]">No editable wording to preview.</p>;

  return (
    <div className="flex flex-col gap-3">
      {smsPreview ? (
        <div className="mx-auto flex w-[240px] max-w-full flex-col gap-2 rounded-[30px] border-[9px] border-[hsl(160_20%_14%)] bg-[hsl(40_20%_97%)] px-2.5 py-4 text-[hsl(160_20%_14%)]" aria-label="SMS preview">
          <span className="text-center text-xs opacity-70">{companyName} · Text message</span>
          <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-[16px_16px_16px_4px] bg-[hsl(220_10%_90%)] px-3 py-2 text-[0.78rem] leading-[1.4]">{smsPreview.body}</div>
          {smsPreview.sms ? <span className="text-right text-xs opacity-70">{`${smsPreview.sms.characters} characters · ${smsPreview.sms.segments} SMS`}</span> : null}
        </div>
      ) : null}
      {emailPreview ? (
        <div className="space-y-1">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{smsPreview ? "Same notification by email" : "Email"}</p>
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white p-3 text-xs text-[#23211c]">
            <div className="opacity-70">From {companyName}</div>
            <b className="break-words">{emailPreview.subject}</b>
            <iframe title="Email body preview" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px/1.5 system-ui,sans-serif;color:#23211c;background:#fff">${emailPreview.html}</body>`} className="mt-2 h-48 w-full rounded border border-[#e5e1d8] bg-white" />
            {email?.source === "TEMPLATE" ? <p className="mt-1 opacity-70">The sent email adds the company header, footer and button around this body.</p> : null}
          </div>
        </div>
      ) : null}
      {inboxPreview ? (
        <div className="space-y-1">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Inbox row</p>
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-sm">
            <p className="font-semibold break-words">{inboxPreview.title}</p>
            <p className="break-words text-xs text-[hsl(var(--e-text-secondary))]">{inboxPreview.body}</p>
          </div>
          {inbox?.push === "SHARED" ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Push: &quot;{inboxPreview.title}&quot; with the same text.</p> : null}
        </div>
      ) : null}
      {!inboxPreview && emailPreview && !smsPreview ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{htmlToText(emailPreview.html).slice(0, 140)}</p> : null}
    </div>
  );
}
