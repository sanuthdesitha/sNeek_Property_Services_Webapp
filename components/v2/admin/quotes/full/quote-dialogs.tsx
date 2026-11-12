"use client";

/**
 * Quote page dialogs: the PDF preview (same render as the download), the
 * email review before sending (the exact email, attachments and public link;
 * nothing is sent until "Send now"), and the delete confirmation.
 */
import * as React from "react";
import { Link2, Loader2, Mail, Paperclip } from "lucide-react";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EModal } from "@/components/v2/admin/estate-kit";
import type { EmailPreview } from "./use-quote-actions";

export function PdfPreviewModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <EModal open={Boolean(url)} onClose={onClose} eyebrow="Quotes" title="Quote preview" size="full">
      {url ? <iframe src={url} title="Quote preview" className="h-[70vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white" /> : null}
    </EModal>
  );
}

export function EmailPreviewModal({ preview, sending, onCancel, onSend }: { preview: EmailPreview | null; sending: boolean; onCancel: () => void; onSend: () => void }) {
  return (
    <EModal open={Boolean(preview)} onClose={() => (sending ? undefined : onCancel())} eyebrow="Quotes" title="Review before sending" size="full">
      {preview ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>To</EEyebrow>
              <p className="mt-1 text-[0.8125rem] [overflow-wrap:anywhere]">{preview.recipients.length > 0 ? preview.recipients.join(", ") : "No recipient on file"}</p>
              <EEyebrow className="mt-3">Subject</EEyebrow>
              <p className="mt-1 text-[0.8125rem]">{preview.subject}</p>
            </div>
            <div className="min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow className="flex items-center gap-1.5"><Paperclip className="h-3 w-3" /> Attachments</EEyebrow>
              {preview.attachments.length === 0 ? (
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">None</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {preview.attachments.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                      <span className="min-w-0 truncate">{a.filename}</span>
                      {typeof a.size === "number" ? <span className="e-tnum shrink-0 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{(a.size / 1024).toFixed(0)} KB</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {preview.publicUrl ? (
                <p className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  <Link2 className="h-3 w-3 shrink-0" /> <span className="min-w-0 truncate">{preview.publicUrl}</span>
                </p>
              ) : null}
            </div>
          </div>
          <iframe srcDoc={preview.html} sandbox="" title="Quote email preview" className="h-[52vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white" />
          <div className="flex flex-wrap justify-end gap-2">
            <EButton variant="outline" onClick={onCancel} disabled={sending}>{preview.afterCreate ? "Keep as draft" : "Cancel"}</EButton>
            <EButton variant="gold" onClick={onSend} disabled={sending || preview.recipients.length === 0}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {sending ? "Sending…" : "Send now"}
            </EButton>
          </div>
        </div>
      ) : null}
    </EModal>
  );
}

export function DeleteQuoteDialog({ open, reference, busy, error, onClose, onConfirm }: { open: boolean; reference: string; busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void }) {
  return (
    <EActionDialog
      open={open}
      title={`Delete quote ${reference}`}
      eyebrow="Quotes"
      busy={busy}
      onClose={onClose}
      description="Deletes the quote and its timeline. A job already created from it is not changed. This cannot be undone."
      footer={
        <>
          <EButton variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton variant="danger" size="sm" onClick={onConfirm} disabled={busy}>{busy ? "Deleting…" : "Delete quote"}</EButton>
        </>
      }
    >
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : <p className="text-[0.8125rem]">The quote is removed from Quotes and pricing.</p>}
    </EActionDialog>
  );
}
