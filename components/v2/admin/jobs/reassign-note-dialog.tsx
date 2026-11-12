"use client";

/**
 * "Tell the client their cleaner changed?" — shown AFTER an assignment that
 * replaced the primary cleaner has saved. The assign route does not email the
 * client in that case; it returns a draft (`reassignPreview`) for a person to
 * read, edit and send, or not. Shared by the assign modal and the calendar's
 * drag-to-reassign so both offer the same note.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";

export type ReassignPreview = {
  clientId: string;
  jobId: string;
  cleanerName: string | null;
  recipients: string[];
  reason: string | null;
  subject: string;
  html: string;
};

/** Read the assign route's `reassignPreview`, or null when there is none. */
export function parseReassignPreview(body: unknown, fallbackJobId: string): ReassignPreview | null {
  if (!body || typeof body !== "object") return null;
  const preview = (body as { reassignPreview?: Record<string, unknown> }).reassignPreview;
  if (!preview || !preview.clientId) return null;
  return {
    clientId: String(preview.clientId),
    jobId: String(preview.jobId ?? fallbackJobId),
    cleanerName: typeof preview.cleanerName === "string" ? preview.cleanerName : null,
    recipients: Array.isArray(preview.recipients) ? preview.recipients.map(String) : [],
    reason: typeof preview.reason === "string" ? preview.reason : null,
    subject: String(preview.subject ?? ""),
    html: String(preview.html ?? ""),
  };
}

export function ReassignNoteDialog({ preview, onClose }: { preview: ReassignPreview; onClose: () => void }) {
  const [subject, setSubject] = useState(preview.subject);
  const [html, setHtml] = useState(preview.html);
  const [sending, setSending] = useState(false);

  /**
   * Send the note as the admin has edited it. `override` carries the edited
   * text to the server: offering an edit and then sending the untouched
   * template would be worse than never offering it.
   */
  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/clients/${preview.clientId}/communications/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "send",
          stage: "CLEANER_REASSIGNED",
          jobId: preview.jobId,
          extra: { cleanerName: preview.cleanerName },
          override: { subject, html },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the note.");
      toast({
        title: "Client told",
        description: body.recipients?.length ? `Sent to ${body.recipients.join(", ")}.` : "The note has been sent.",
      });
      onClose();
    } catch (err: unknown) {
      toast({ title: "Not sent", description: err instanceof Error ? err.message : "Could not send the note.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  // Closing without sending is a legitimate outcome (the office may ring the
  // client), so "Don't send" is a plain button, not a cancel.
  return (
    <EModal open onClose={onClose} title="Tell the client their cleaner changed?" eyebrow="Not sent yet" size="wide">
      <div className="space-y-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          The assignment is saved. This note has <strong>not</strong> been sent — read it, change
          anything you want, then send or close.
        </p>

        {preview.recipients.length === 0 ? (
          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] p-3 text-[0.8125rem]">
            {preview.reason ?? "No client email on file, so there is nobody to send this to."}
          </p>
        ) : (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">To: {preview.recipients.join(", ")}</p>
        )}

        <label className="block space-y-1">
          <span className="text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem]"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Message</span>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={10}
            className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 font-mono text-[0.75rem]"
          />
        </label>

        <div className="flex items-center justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="outline" onClick={onClose} disabled={sending}>
            Don&apos;t send
          </EButton>
          <EButton variant="gold" onClick={send} disabled={sending || preview.recipients.length === 0 || !subject.trim()}>
            {sending ? "Sending…" : "Send to client"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
