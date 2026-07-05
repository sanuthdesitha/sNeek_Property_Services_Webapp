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
}: {
  applicationId: string;
  open: boolean;
  onClose: () => void;
  defaultTemplate?: string;
  recipientName?: string;
  onSent?: () => void;
  onToast?: (msg: { title: string; tone?: "success" | "danger" }) => void;
}) {
  const [template, setTemplate] = useState(defaultTemplate);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // (Re)load the rendered template whenever the modal opens or template changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/workforce/hiring/applications/${applicationId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, preview: true }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSubject(data.subject ?? "");
        setHtml(data.html ?? "");
        setTo(data.to ?? "");
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, template, applicationId]);

  useEffect(() => {
    if (open) setTemplate(defaultTemplate);
  }, [open, defaultTemplate]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${applicationId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, subject, html }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        onToast?.({ title: body.error ?? "Email not sent.", tone: "danger" });
        return;
      }
      onToast?.({ title: `Email sent to ${to}`, tone: "success" });
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
      title={recipientName ? `Email ${recipientName}` : "Send email"}
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
            {loading ? (
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

        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="outline" size="sm" onClick={onClose} disabled={sending}>
            Don&apos;t send
          </EButton>
          <EButton variant="primary" size="sm" onClick={send} disabled={sending || loading || !subject.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send email
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
