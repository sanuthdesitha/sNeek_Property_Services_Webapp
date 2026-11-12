"use client";

/**
 * Composer: Reply to client | Internal note (the existing `isInternal` flag),
 * Insert template (the existing resolution templates), Attach (the existing
 * upload and attach calls) and Send.
 *
 * - An internal note is never sent to the client: it posts with isInternal true.
 * - A reply is a non-internal message. It reaches the client only when the case
 *   is client-visible, exactly as before; the composer says so when it is not.
 * - The unsent text is kept per case while this page is open, so switching
 *   cases does not lose it; a failed send keeps it too.
 */
import * as React from "react";
import { Paperclip, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EButton } from "@/components/v2/ui/primitives";
import { E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import { RESOLUTION_TEMPLATES, type CaseDetail } from "./case-types";

export type ComposerDraft = { body: string; isInternal: boolean };

type Props = {
  detail: CaseDetail;
  draft: ComposerDraft;
  onDraft: (draft: ComposerDraft) => void;
  sending: boolean;
  uploading: boolean;
  onSend: () => void;
  onAttach: (file: File) => void;
};

export function defaultDraft(detail: Pick<CaseDetail, "clientVisible">): ComposerDraft {
  // Reply to client is the default only where the client can actually see the case.
  return { body: "", isInternal: !detail.clientVisible };
}

export function CaseComposer({ detail, draft, onDraft, sending, uploading, onSend, onAttach }: Props) {
  const textId = React.useId();
  const noteId = React.useId();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const busy = sending || uploading;

  function insertTemplate() {
    const template = RESOLUTION_TEMPLATES[detail.caseType];
    onDraft({ ...draft, body: draft.body.trim() ? `${draft.body.trimEnd()}\n\n${template}` : template });
  }

  const visibilityNote = draft.isInternal
    ? "Internal notes are only visible to the office."
    : detail.clientVisible
      ? "The client will see this reply on their case."
      : "The client cannot see this case, so this reply stays on the office timeline until “Client can see” is turned on.";

  return (
    <div className="flex flex-col gap-2 border-t border-[hsl(var(--e-border))] px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Message type">
        <button type="button" aria-pressed={!draft.isInternal} disabled={busy} onClick={() => onDraft({ ...draft, isInternal: false })} className={cn(E_CHIP_CLASS, !draft.isInternal && E_CHIP_ON_CLASS)}>
          Reply to client
        </button>
        <button type="button" aria-pressed={draft.isInternal} disabled={busy} onClick={() => onDraft({ ...draft, isInternal: true })} className={cn(E_CHIP_CLASS, draft.isInternal && E_CHIP_ON_CLASS)}>
          Internal note
        </button>
        <span className="flex-1" />
        <button type="button" disabled={busy} onClick={insertTemplate} className={E_CHIP_CLASS}>
          <Wand2 aria-hidden className="h-3 w-3" /> Insert template
        </button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={E_CHIP_CLASS}>
          <Paperclip aria-hidden className="h-3 w-3" /> {uploading ? "Uploading…" : "Attach"}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          aria-label="Attach a file to this case"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onAttach(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <div className="flex items-end gap-2">
        <label htmlFor={textId} className="sr-only">{draft.isInternal ? "Internal note" : "Reply"}</label>
        <textarea
          id={textId}
          rows={2}
          value={draft.body}
          disabled={sending}
          aria-describedby={noteId}
          onChange={(event) => onDraft({ ...draft, body: event.target.value })}
          placeholder={draft.isInternal ? "Write an internal note…" : "Write a reply…"}
          className={cn(E_INPUT_CLASS, "min-h-11 flex-1 resize-y py-2 text-[16px] sm:text-[0.875rem]")}
        />
        <EButton onClick={onSend} disabled={busy || !draft.body.trim()}>{sending ? "Sending…" : "Send"}</EButton>
      </div>
      <p id={noteId} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {visibilityNote} Unsent text is kept for each case while this page stays open.
      </p>
    </div>
  );
}
