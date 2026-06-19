"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

export const HIRING_EMAIL_TEMPLATES = [
  { value: "thank_you", label: "Thank you for applying" },
  { value: "interview", label: "Interview invitation" },
  { value: "offer", label: "Offer details" },
  { value: "welcome", label: "Welcome to the team" },
] as const;

/**
 * Email send with a mandatory preview + confirm. Renders the chosen template
 * (editable subject/body), shows a live preview, and only sends on explicit
 * confirmation. Used by every "send email" action in hiring.
 */
export function EmailPreviewDialog({
  applicationId,
  open,
  onOpenChange,
  defaultTemplate = "thank_you",
  recipientName,
  onSent,
}: {
  applicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTemplate?: string;
  recipientName?: string;
  onSent?: () => void;
}) {
  const [template, setTemplate] = useState(defaultTemplate);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // (Re)load the rendered template whenever the dialog opens or template changes.
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
    return () => {
      cancelled = true;
    };
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
        toast({ title: "Email not sent", description: body.error ?? "Delivery failed.", variant: "destructive" });
        return;
      }
      toast({ title: "Email sent", description: `Sent to ${to}` });
      onOpenChange(false);
      onSent?.();
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Send email{recipientName ? ` to ${recipientName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Template</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HIRING_EMAIL_TEMPLATES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input value={to} disabled />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Body (HTML — edit if needed)</Label>
            <Textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={6} className="font-mono text-xs" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Preview</Label>
            <div className="rounded-lg border bg-muted/30 p-2">
              {loading ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering…
                </div>
              ) : (
                <iframe title="Email preview" srcDoc={html} className="h-48 w-full rounded border-0 bg-white" />
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Don&apos;t send
          </Button>
          <Button onClick={send} disabled={sending || loading || !subject.trim()}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Send email
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
