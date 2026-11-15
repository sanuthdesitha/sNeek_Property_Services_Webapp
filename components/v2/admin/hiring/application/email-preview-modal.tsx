"use client";

/**
 * ESTATE-native email preview → confirm → send. Renders the chosen template
 * (editable subject/body), shows a live sandboxed iframe preview, and only
 * sends on explicit confirmation. Ported from
 * components/hiring/email-preview-dialog.tsx onto the Estate EModal — same
 * endpoint (`POST .../applications/[id]/email`, preview flag) and payload.
 */
import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal, EField, EInput, ETextarea, ESelect } from "@/components/v2/admin/estate-kit";

export const HIRING_EMAIL_TEMPLATES = [
  { value: "thank_you", label: "Thank you for applying" },
  { value: "interview", label: "Interview invitation" },
  { value: "offer", label: "Offer details" },
  { value: "welcome", label: "Welcome to the team" },
] as const;

export function EmailPreviewModal({
  applicationId,
  open,
  onClose,
  defaultTemplate = "thank_you",
  recipientName,
  onSent,
  onToast,
  move,
}: {
  applicationId: string;
  open: boolean;
  onClose: () => void;
  defaultTemplate?: string;
  recipientName?: string;
  onSent?: () => void;
  onToast?: (msg: { title: string; tone?: "success" | "danger" }) => void;
  /**
   * A stage move (board "Hiring", 2026-11-16): the move waits for this preview.
   * "Move without email" moves only; "Move and send" moves, then sends. The
   * move itself never sends. `run` returns an error sentence, or null.
   */
  move?: { targetLabel: string; run: () => Promise<string | null> };
}) {
  const [template, setTemplate] = useState(defaultTemplate);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [moved, setMoved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)load the rendered template whenever the modal opens or template changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/admin/workforce/hiring/applications/${applicationId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, preview: true }),
    })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setLoadError(data.error ?? "The email could not be prepared.");
          return;
        }
        setSubject(data.subject ?? "");
        setHtml(data.html ?? "");
        setTo(data.to ?? "");
      })
      .catch(() => {
        if (!cancelled) setLoadError("The email could not be prepared.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, template, applicationId]);

  useEffect(() => {
    if (open) setTemplate(defaultTemplate);
    if (open) {
      setMoved(false);
      setError(null);
    }
  }, [open, defaultTemplate]);

  async function moveOnly() {
    if (!move) return;
    setSending(true);
    setError(null);
    try {
      const failure = await move.run();
      if (failure) {
        setError(`Not moved: ${failure}`);
        return;
      }
      onToast?.({ title: `Moved to ${move.targetLabel}. No email was sent.`, tone: "success" });
      onClose();
      onSent?.();
    } finally {
      setSending(false);
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      if (move && !moved) {
        const failure = await move.run();
        if (failure) {
          setError(`Not moved and not sent: ${failure}`);
          return;
        }
        setMoved(true);
      }
      const res = await fetch(`/api/admin/workforce/hiring/applications/${applicationId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, subject, html }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        const reason = body.error ?? "Email not sent.";
        setError(move ? `Moved to ${move.targetLabel}, but the email was not sent: ${reason}` : `Not sent: ${reason}`);
        onToast?.({ title: reason, tone: "danger" });
        return;
      }
      onToast?.({ title: `Email accepted for sending to ${to}`, tone: "success" });
      onClose();
      onSent?.();
    } finally {
      setSending(false);
    }
  }

  return (
    <EModal
      open={open}
      onClose={onClose}
      wide
      eyebrow="Correspondence"
      title={move ? `Move to ${move.targetLabel}${recipientName ? `: ${recipientName}` : ""}` : recipientName ? `Email ${recipientName}` : "Send email"}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Template">
            <ESelect value={template} onChange={(e) => setTemplate(e.target.value)}>
              {HIRING_EMAIL_TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </ESelect>
          </EField>
          <EField label="To">
            <EInput value={to} disabled />
          </EField>
        </div>

        <EField label="Subject">
          <EInput value={subject} onChange={(e) => setSubject(e.target.value)} />
        </EField>

        <EField label="Body (HTML — edit if needed)">
          <ETextarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={6}
            className="font-mono text-[0.75rem]"
          />
        </EField>

        <EField label="Preview">
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2">
            {loadError ? (
              <p role="alert" className="p-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">{loadError}</p>
            ) : loading ? (
              <div className="flex h-32 items-center justify-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering…
              </div>
            ) : (
              <iframe
                title="Email preview"
                srcDoc={html}
                // sandbox="" = maximally restrictive: candidate-controlled HTML
                // (e.g. their name) must never execute in the admin origin.
                sandbox=""
                className="h-48 w-full rounded border-0 bg-white"
              />
            )}
          </div>
        </EField>

        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        {move ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {moved ? `Moved to ${move.targetLabel}. Send the email, or close without sending.` : `The application moves to ${move.targetLabel} only when you press a button below. Nothing is sent unless you press Move and send.`}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1 max-sm:flex-col-reverse max-sm:items-stretch">
          <EButton variant="outline" size="sm" onClick={moved ? () => { onClose(); onSent?.(); } : onClose} disabled={sending}>
            {move && !moved ? "Cancel" : "Don't send"}
          </EButton>
          {move && !moved ? (
            <EButton variant="outline" size="sm" onClick={moveOnly} disabled={sending}>
              Move without email
            </EButton>
          ) : null}
          <EButton variant="primary" size="sm" onClick={send} disabled={sending || loading || Boolean(loadError) || !subject.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {move && !moved ? "Move and send" : "Send email"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
