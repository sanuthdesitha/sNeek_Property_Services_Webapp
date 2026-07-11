"use client";

/**
 * ESTATE quote detail — v2-native view/manage screen for a single quote.
 * Same endpoints as the pipeline:
 *   PATCH  /api/admin/quotes/[id]          { status | notes | validUntil | clientId }
 *   POST   /api/admin/quotes/[id]/send     { to? }
 *   GET    /api/admin/quotes/[id]/pdf      (download)
 *   POST   /api/admin/quotes/[id]/convert-to-job { propertyId, scheduledDate }
 * Built on v2 primitives + estate-kit only.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarPlus, Copy, Download, Eye, Loader2, Mail, Paperclip, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESelect, EModal, ESwitch } from "@/components/v2/admin/estate-kit";
import { formatCurrency } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "danger" | "gold";
const QUOTE_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  DECLINED: "danger",
  CONVERTED: "gold",
};
const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"];

type Party = { id: string; name: string; email: string };
type ReferenceImage = { key: string; url: string; label?: string };
type QuoteInitial = {
  id: string;
  status: string;
  serviceType: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  notes: string;
  validUntil: string | null;
  createdAt: string;
  clientId: string | null;
  client: Party | null;
  lead: Party | null;
  publicToken?: string | null;
  showAddOnPrices?: boolean;
  referenceImages?: ReferenceImage[];
  serviceContext?: Record<string, string | number | boolean> | null;
};

const prettify = (v?: string | null) => String(v ?? "").replace(/_/g, " ").trim();
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function QuoteDetail({ initial, clients }: { initial: QuoteInitial; clients: Party[] }) {
  const router = useRouter();
  const [quote, setQuote] = useState<QuoteInitial>(initial);
  const [status, setStatus] = useState(initial.status);
  const [notes, setNotes] = useState(initial.notes);
  const [validUntil, setValidUntil] = useState(dateInput(initial.validUntil));
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [sending, setSending] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [properties, setProperties] = useState<Array<{ id: string; name: string; suburb?: string | null }>>([]);
  const [convertPropertyId, setConvertPropertyId] = useState("");
  const [convertDate, setConvertDate] = useState("");

  useEffect(() => {
    if (!convertOpen || properties.length > 0) return;
    fetch("/api/admin/properties", { cache: "no-store" })
      .then((res) => res.json().catch(() => []))
      .then((rows) => setProperties(Array.isArray(rows) ? rows : Array.isArray(rows?.properties) ? rows.properties : []))
      .catch(() => setProperties([]));
  }, [convertOpen, properties.length]);

  async function convertToJob() {
    if (!convertPropertyId || !convertDate) {
      toast({ title: "Property and date are required.", variant: "destructive" });
      return;
    }
    setConverting(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/convert-to-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: convertPropertyId,
          scheduledDate: `${convertDate}T00:00:00.000Z`,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to convert quote.");
      toast({ title: "Quote converted to job" });
      setConvertOpen(false);
      if (body.job?.id) {
        router.push(`/v2/admin/jobs/${body.job.id}`);
      }
      router.refresh();
    } catch (err: any) {
      toast({ title: "Convert failed", description: err?.message ?? "Failed to convert quote.", variant: "destructive" });
    } finally {
      setConverting(false);
    }
  }

  async function patch(body: Record<string, unknown>): Promise<QuoteInitial | null> {
    const res = await fetch(`/api/admin/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Update failed", description: data.error ?? "Could not update quote.", variant: "destructive" });
      return null;
    }
    return data as QuoteInitial;
  }

  async function saveDetails() {
    setSavingDetails(true);
    try {
      const updated = await patch({
        status,
        notes: notes.trim() ? notes.trim() : null,
        validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
      });
      if (updated) {
        setQuote((q) => ({ ...q, ...updated }));
        toast({ title: "Quote updated" });
        router.refresh();
      }
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveClient() {
    setSavingClient(true);
    try {
      const updated = await patch({ clientId: clientId || null });
      if (updated) {
        setQuote((q) => ({ ...q, ...updated }));
        toast({ title: clientId ? "Quote assigned to client" : "Quote unassigned" });
        router.refresh();
      }
    } finally {
      setSavingClient(false);
    }
  }

  // ── Send with an email preview step (render first, confirm, then send) ────
  type EmailPreview = {
    to: string;
    subject: string;
    html: string;
    attachments: Array<{ filename: string; size?: number }>;
    publicUrl?: string;
  };
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [sendingNow, setSendingNow] = useState(false);

  async function sendQuote() {
    const recipient = window.prompt("Send quote to email:", quote.client?.email ?? quote.lead?.email ?? "");
    if (!recipient) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/send?preview=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipient, preview: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Preview failed", description: body.error ?? "Could not render the email.", variant: "destructive" });
        return;
      }
      setEmailPreview({
        to: recipient,
        subject: String(body.subject ?? ""),
        html: String(body.html ?? ""),
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        publicUrl: typeof body.publicUrl === "string" ? body.publicUrl : undefined,
      });
    } finally {
      setSending(false);
    }
  }

  async function confirmSend() {
    if (!emailPreview) return;
    setSendingNow(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailPreview.to }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Send failed", description: body.error ?? "Could not send quote.", variant: "destructive" });
        return;
      }
      toast({
        title: "Quote sent",
        description: `Sent to ${emailPreview.to} with ${
          Array.isArray(body.attachments) ? body.attachments.length : 0
        } attachment(s).`,
      });
      setEmailPreview(null);
      router.refresh();
    } finally {
      setSendingNow(false);
    }
  }

  // ── Shareable public link (mint the token on first copy) ──────────────────
  const [copyingLink, setCopyingLink] = useState(false);

  async function copyPublicLink() {
    setCopyingLink(true);
    try {
      let token = quote.publicToken ?? null;
      if (!token) {
        const updated = await patch({ generatePublicToken: true });
        if (!updated) return;
        token = (updated as QuoteInitial).publicToken ?? null;
        setQuote((q) => ({ ...q, ...updated }));
      }
      if (!token) {
        toast({ title: "Could not create the public link.", variant: "destructive" });
        return;
      }
      const url = `${window.location.origin}/q/${token}`;
      await navigator.clipboard.writeText(url);
      toast({ title: "Public link copied", description: url });
    } catch {
      toast({ title: "Could not copy the link.", variant: "destructive" });
    } finally {
      setCopyingLink(false);
    }
  }

  // ── Add-on price visibility (persists immediately) ────────────────────────
  const [addOnPricesVisible, setAddOnPricesVisible] = useState(Boolean(initial.showAddOnPrices));

  async function toggleAddOnPrices(value: boolean) {
    setAddOnPricesVisible(value);
    const updated = await patch({ showAddOnPrices: value });
    if (!updated) {
      setAddOnPricesVisible(!value); // revert on failure
    } else {
      setQuote((q) => ({ ...q, ...updated }));
      toast({
        title: value ? "Add-on prices shown to client" : "Add-on prices hidden",
        description: "Applies to the attached add-on list and the online quote.",
      });
    }
  }

  // Inline preview — same render endpoint as the PDF download; the blob is
  // shown in an iframe (works for both application/pdf and the HTML fallback).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openPreview() {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not render the quote preview.");
      }
      const blob = await res.blob();
      setPreviewUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return window.URL.createObjectURL(blob);
      });
    } catch (err: any) {
      toast({ title: "Preview failed", description: err?.message ?? "Could not render preview.", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewUrl((prev) => {
      if (prev) window.URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function downloadPdf() {
    const res = await fetch(`/api/admin/quotes/${quote.id}/pdf`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not export PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-${quote.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  const recipientName = quote.client?.name ?? quote.lead?.name ?? "Direct quote";
  const recipientEmail = quote.client?.email ?? quote.lead?.email ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EButton asChild variant="outline" size="sm">
          <Link href="/v2/admin/quotes">Back to pipeline</Link>
        </EButton>
        <div className="flex flex-wrap items-center gap-2">
          <EButton variant="ghost" size="sm" onClick={openPreview} disabled={previewLoading}>
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview
          </EButton>
          <EButton variant="ghost" size="sm" onClick={downloadPdf}>
            <Download className="h-3.5 w-3.5" /> PDF
          </EButton>
          <EButton variant="ghost" size="sm" onClick={copyPublicLink} disabled={copyingLink}>
            {copyingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Copy public link
          </EButton>
          <EButton variant="outline-gold" size="sm" onClick={sendQuote} disabled={sending}>
            <Send className="h-3.5 w-3.5" /> {sending ? "Preparing…" : "Send"}
          </EButton>
          {quote.status !== "CONVERTED" ? (
            <EButton variant="primary" size="sm" onClick={() => setConvertOpen(true)}>
              <CalendarPlus className="h-3.5 w-3.5" /> Convert to job
            </EButton>
          ) : null}
        </div>
      </div>

      {/* Inline document preview — same render as the emailed / downloaded quote */}
      <EModal open={Boolean(previewUrl)} onClose={closePreview} eyebrow="Quotes" title="Quote preview" size="full">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="Quote preview"
            className="h-[70vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
          />
        ) : null}
      </EModal>

      {/* Email preview — the exact email + attachments, confirmed before sending */}
      <EModal
        open={Boolean(emailPreview)}
        onClose={() => setEmailPreview(null)}
        eyebrow="Quotes"
        title="Review before sending"
        size="full"
      >
        {emailPreview ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <EEyebrow>To</EEyebrow>
                <p className="mt-1 text-[0.8125rem]">{emailPreview.to}</p>
                <EEyebrow className="mt-3">Subject</EEyebrow>
                <p className="mt-1 text-[0.8125rem]">{emailPreview.subject}</p>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <EEyebrow className="flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3" /> Attachments
                </EEyebrow>
                {emailPreview.attachments.length === 0 ? (
                  <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">None</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {emailPreview.attachments.map((a, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                        <span className="min-w-0 truncate">{a.filename}</span>
                        {typeof a.size === "number" ? (
                          <span className="e-tnum shrink-0 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                            {(a.size / 1024).toFixed(0)} KB
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {emailPreview.publicUrl ? (
                  <p className="mt-3 min-w-0 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Online: {emailPreview.publicUrl}
                  </p>
                ) : null}
              </div>
            </div>
            <iframe
              srcDoc={emailPreview.html}
              sandbox=""
              title="Quote email preview"
              className="h-[52vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <EButton variant="outline" onClick={() => setEmailPreview(null)} disabled={sendingNow}>
                Cancel
              </EButton>
              <EButton variant="gold" onClick={confirmSend} disabled={sendingNow}>
                {sendingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {sendingNow ? "Sending…" : "Send now"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Convert to job — same payload as the classic flow */}
      <EModal open={convertOpen} onClose={() => setConvertOpen(false)} eyebrow="Quotes" title="Convert to job">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            Creates a {prettify(quote.serviceType).toLowerCase() || "service"} job from this quote and marks the quote as converted.
          </p>
          <EField label="Property">
            <ESelect value={convertPropertyId} onChange={(e) => setConvertPropertyId(e.target.value)}>
              <option value="">Select property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.suburb ? ` — ${p.suburb}` : ""}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Scheduled date">
            <EInput type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setConvertOpen(false)} disabled={converting}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={convertToJob} disabled={converting || !convertPropertyId || !convertDate}>
              {converting ? "Converting…" : "Create job"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Summary */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between">
          <div className="min-w-0">
            <ECardTitle className="e-serif truncate">{recipientName}</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {prettify(quote.serviceType)}
              {recipientEmail ? ` · ${recipientEmail}` : ""}
              {" · "}
              {format(new Date(quote.createdAt), "dd MMM yyyy")}
              {!quote.clientId && quote.lead?.name ? " · lead" : ""}
            </p>
          </div>
          <EBadge tone={QUOTE_TONES[quote.status] ?? "neutral"} soft>
            {prettify(quote.status)}
          </EBadge>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>Subtotal</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{formatCurrency(quote.subtotal)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>GST</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{formatCurrency(quote.gstAmount)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
              <EEyebrow>Total</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none text-[hsl(var(--e-gold-ink))]">
                {formatCurrency(quote.totalAmount)}
              </p>
            </div>
          </div>
        </ECardBody>
      </ECard>

      {/* Reference photos + client-facing options */}
      {(quote.referenceImages?.length ?? 0) > 0 ||
      (quote.serviceContext && Object.keys(quote.serviceContext).length > 0) ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Quote context</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Reference photos and the pricing selections captured when this quote was built.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            {(quote.referenceImages?.length ?? 0) > 0 ? (
              <div>
                <EEyebrow>Client reference photos</EEyebrow>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {(quote.referenceImages ?? []).map((img, idx) => (
                    <a
                      key={img.key}
                      href={img.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1.5 transition-colors hover:border-[hsl(var(--e-border-gold)/0.5)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.label || `Reference ${idx + 1}`}
                        className="h-24 w-full rounded-[var(--e-radius)] object-cover"
                      />
                      {img.label ? (
                        <p className="truncate px-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                          {img.label}
                        </p>
                      ) : null}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            {quote.serviceContext && Object.keys(quote.serviceContext).length > 0 ? (
              <div>
                <EEyebrow>Pricing selections</EEyebrow>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Array.from(Object.entries(quote.serviceContext)).map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-2.5 py-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]"
                    >
                      {prettify(key)}: <span className="font-[550]">{prettify(String(value))}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Manage */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ECard>
          <ECardHeader>
            <ECardTitle>Status &amp; details</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <EField label="Status">
              <ESelect value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {prettify(s)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Valid until">
              <EInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </EField>
            <EField label="Notes">
              <ETextarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, inclusions…" />
            </EField>
            <ESwitch
              checked={addOnPricesVisible}
              onCheckedChange={toggleAddOnPrices}
              label="Show add-on prices to client"
            />
            <EThread />
            <div className="flex justify-end">
              <EButton variant="primary" size="sm" onClick={saveDetails} disabled={savingDetails}>
                {savingDetails ? "Saving…" : "Save changes"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>

        <ECard>
          <ECardHeader>
            <ECardTitle>Addressed to</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Assign this quote to a client so they can view and accept it from their portal.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <EField label="Client">
              <ESelect value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">
                  Unassigned{quote.lead?.name ? ` (lead: ${quote.lead.name})` : ""}
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EThread />
            <div className="flex justify-end">
              <EButton variant="outline" size="sm" onClick={saveClient} disabled={savingClient}>
                {savingClient ? "Saving…" : "Save assignment"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </div>
    </div>
  );
}
