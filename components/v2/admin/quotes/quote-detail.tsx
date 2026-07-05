"use client";

/**
 * ESTATE quote detail — v2-native view/manage screen for a single quote.
 * Same endpoints as the pipeline:
 *   PATCH  /api/admin/quotes/[id]          { status | notes | validUntil | clientId }
 *   POST   /api/admin/quotes/[id]/send     { to? }
 *   GET    /api/admin/quotes/[id]/pdf      (download)
 * The deep line-item editor & conversion stay in the existing flows; conversion
 * links to the classic convert screen. Built on v2 primitives + estate-kit only.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Download, Send } from "lucide-react";
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
import { EField, EInput, ETextarea, ESelect } from "@/components/v2/admin/estate-kit";
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

  async function sendQuote() {
    const recipient = window.prompt("Send quote to email:", quote.client?.email ?? quote.lead?.email ?? "");
    if (!recipient) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipient }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Send failed", description: body.error ?? "Could not send quote.", variant: "destructive" });
        return;
      }
      toast({ title: "Quote sent", description: `Sent to ${recipient}` });
      router.refresh();
    } finally {
      setSending(false);
    }
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
          <EButton variant="ghost" size="sm" onClick={downloadPdf}>
            <Download className="h-3.5 w-3.5" /> PDF
          </EButton>
          <EButton variant="outline-gold" size="sm" onClick={sendQuote} disabled={sending}>
            <Send className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send"}
          </EButton>
          {quote.status !== "CONVERTED" ? (
            <EButton asChild variant="primary" size="sm">
              <Link href={`/admin/quotes/${quote.id}/convert`}>Convert to job</Link>
            </EButton>
          ) : null}
        </div>
      </div>

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
