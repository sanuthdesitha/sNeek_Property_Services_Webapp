"use client";

/**
 * Client Documents — re-send any document a client asks for (quote, invoice,
 * service checklist, add-ons list, online add-on link, clean report), always
 * with a preview before it goes out. Mounted on the Client 360 page.
 */
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Paperclip, RefreshCw, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EField, ESelect } from "@/components/v2/admin/estate-kit";

type DocType = { type: string; label: string; description: string; targetKind: "quote" | "invoice" | "report" };
type Target = { id: string; label: string };
type Preview = {
  ok: boolean;
  subject: string;
  html: string;
  attachments: { filename: string; size: number }[];
  recipients: string[];
  reason?: string;
};

function formatKb(bytes: number) {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

export default function ClientDocuments({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(true);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [quotes, setQuotes] = useState<Target[]>([]);
  const [invoices, setInvoices] = useState<Target[]>([]);
  const [reports, setReports] = useState<Target[]>([]);

  const [docType, setDocType] = useState<string>("");
  const [targetId, setTargetId] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/documents`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDocTypes(Array.isArray(data.documentTypes) ? data.documentTypes : []);
        setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
        setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
        setReports(Array.isArray(data.reports) ? data.reports : []);
        if (!docType && Array.isArray(data.documentTypes) && data.documentTypes[0]) {
          setDocType(data.documentTypes[0].type);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [clientId, docType]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const meta = docTypes.find((d) => d.type === docType) ?? null;
  const targets = meta?.targetKind === "invoice" ? invoices : meta?.targetKind === "report" ? reports : quotes;

  // Reset the target + preview when the document type changes.
  useEffect(() => {
    setTargetId("");
    setPreview(null);
  }, [docType]);

  async function doPreview() {
    if (!docType || !targetId) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/documents/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, targetId, mode: "preview" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Preview failed", description: data.error ?? "Could not render the document.", variant: "destructive" });
        return;
      }
      setPreview(data as Preview);
    } finally {
      setPreviewing(false);
    }
  }

  async function doSend() {
    if (!docType || !targetId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/documents/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, targetId, mode: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Send failed", description: data.error ?? "Could not send the document.", variant: "destructive" });
        return;
      }
      toast({ title: "Document sent", description: `Sent to ${(data.recipients ?? []).join(", ") || "the client"}.` });
      setPreview(null);
    } finally {
      setSending(false);
    }
  }

  const targetLabel = meta?.targetKind === "invoice" ? "Invoice" : meta?.targetKind === "report" ? "Report / job" : "Quote";

  return (
    <ECard>
      <ECardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[hsl(var(--e-gold))]" />
          <ECardTitle>Re-send a document</ECardTitle>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Send the client any document again — quote, invoice, checklist, add-ons list, online link, or report. Preview first.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-4 pt-0">
        {loading ? (
          <p className="flex items-center gap-2 text-[0.85rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading documents…
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Document">
                <ESelect value={docType} onChange={(e) => setDocType(e.target.value)}>
                  {docTypes.map((d) => (
                    <option key={d.type} value={d.type}>
                      {d.label}
                    </option>
                  ))}
                </ESelect>
              </EField>
              <EField label={targetLabel}>
                <ESelect value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Select {targetLabel.toLowerCase()}…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </ESelect>
              </EField>
            </div>
            {meta ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{meta.description}</p> : null}
            {targets.length === 0 ? (
              <p className="text-[0.8rem] text-[hsl(var(--e-muted-foreground))]">
                No {targetLabel.toLowerCase()}s on record for this client yet.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <EButton variant="outline" size="sm" onClick={doPreview} disabled={previewing || !targetId}>
                {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Preview
              </EButton>
              <EButton variant="outline-gold" size="sm" onClick={doSend} disabled={sending || !targetId || !preview?.ok}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send now
              </EButton>
              <EButton variant="ghost" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </EButton>
            </div>

            {preview ? (
              <div className="space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-3">
                <div className="flex flex-wrap items-center gap-2 text-[0.8rem]">
                  <span className="text-[hsl(var(--e-muted-foreground))]">To:</span>
                  {preview.recipients.length ? (
                    preview.recipients.map((r) => (
                      <EBadge key={r} tone="info">
                        {r}
                      </EBadge>
                    ))
                  ) : (
                    <EBadge tone="danger">No recipient — {preview.reason ?? "no client email"}</EBadge>
                  )}
                </div>
                <p className="text-[0.9rem] font-medium">{preview.subject}</p>
                {preview.attachments.length ? (
                  <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <Paperclip className="h-3.5 w-3.5" />
                    {preview.attachments.map((a) => (
                      <span key={a.filename}>
                        {a.filename} ({formatKb(a.size)})
                      </span>
                    ))}
                  </div>
                ) : null}
                <div
                  className="max-h-64 overflow-auto rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface))] p-3 text-[0.85rem] [&_a]:text-[hsl(var(--e-gold))]"
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </div>
            ) : null}
          </>
        )}
      </ECardBody>
    </ECard>
  );
}
