"use client";

/**
 * Estate job-detail "Send reminder" — shown by the server page only when the
 * job is PAUSED, or IN_PROGRESS for more than 24h. Always confirms in a modal
 * before sending, and lets the admin pick the channel (push or email) plus an
 * optional note. POSTs to /api/admin/jobs/[id]/remind, which fans out to every
 * non-removed assigned cleaner and audits the send.
 */
import { useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";

type ReminderMethod = "PUSH" | "EMAIL";

export function JobReminderButton({ jobId, statusLabel }: { jobId: string; statusLabel: string }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ReminderMethod>("PUSH");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not send the reminder.");
      const sent: string[] = Array.isArray(body?.sent) ? body.sent : [];
      const failed: string[] = Array.isArray(body?.failed) ? body.failed : [];
      toast({
        title: sent.length > 0 ? "Reminder sent" : "Reminder not delivered",
        description:
          [
            sent.length > 0 ? `Sent to ${sent.join(", ")}` : null,
            failed.length > 0 ? `Failed for ${failed.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "No recipients.",
        variant: sent.length > 0 ? undefined : "destructive",
      });
      setOpen(false);
      setNote("");
    } catch (err: any) {
      toast({
        title: "Reminder failed",
        description: err?.message ?? "Please retry.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <EButton variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BellRing className="h-3.5 w-3.5" />
        Send reminder
      </EButton>

      <EModal open={open} onClose={() => setOpen(false)} title="Send job reminder" eyebrow="Please confirm">
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            This job is {statusLabel.toLowerCase()}. Remind every assigned cleaner to open it and
            submit their checklist?
          </p>
          <EField label="Method">
            <ESelect value={method} onChange={(e) => setMethod(e.target.value as ReminderMethod)}>
              <option value="PUSH">Push notification</option>
              <option value="EMAIL">Email</option>
            </ESelect>
          </EField>
          <EField label="Note (optional)" hint="Included in the reminder message.">
            <EInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Please finish before 5pm today"
              maxLength={1000}
            />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </EButton>
            <EButton variant="gold" onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
              {sending ? "Sending…" : "Send reminder"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}
