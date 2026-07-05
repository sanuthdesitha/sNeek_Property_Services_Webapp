"use client";

/**
 * ESTATE quotes pipeline — leads + quotes in one native Estate workspace.
 * Same endpoints as the legacy hub (/api/admin/leads, /api/admin/quotes,
 * /api/admin/clients); brand-new Estate UI. The quote BUILDER and per-quote
 * DETAIL are now native Estate screens under /v2/admin/quotes/*.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Copy,
  Download,
  Mail,
  Phone,
  Send,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

const LEAD_TONES: Record<string, Tone> = {
  NEW: "info",
  CONTACTED: "primary",
  QUOTED: "gold",
  CONVERTED: "success",
  LOST: "danger",
};

const QUOTE_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  DECLINED: "danger",
  CONVERTED: "gold",
};

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUOTED", "CONVERTED", "LOST"];

const INPUT_CLS =
  "h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] outline-none transition-colors " +
  "focus:border-[hsl(var(--e-ring))] focus:ring-1 focus:ring-[hsl(var(--e-ring))]";

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

/* ── Minimal Estate modal (hairline, warm surface) ─────────────────────── */
function EModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-6 shadow-[var(--e-elevation-3)]">
        <div className="flex items-start justify-between gap-3">
          <p className="e-display-sm">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[var(--e-radius-sm)] p-1 text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function QuotesPipeline() {
  const [tab, setTab] = useState<"leads" | "quotes">("leads");
  const [leads, setLeads] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string; email?: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [assignTarget, setAssignTarget] = useState<any | null>(null);
  const [assignClientId, setAssignClientId] = useState("");
  const [assigning, setAssigning] = useState(false);

  function loadData() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/leads").then((r) => r.json()).then((d) => setLeads(Array.isArray(d) ? d : [])),
      fetch("/api/admin/quotes").then((r) => r.json()).then((d) => setQuotes(Array.isArray(d) ? d : [])),
      fetch("/api/admin/clients").then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : [])),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  /* ── Lead actions — same PATCH / create-client endpoints as v1 ────────── */
  async function patchLead(leadId: string, patch: Record<string, unknown>, successTitle: string) {
    setBusyLeadId(leadId);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update lead.");
      setLeads((current) => current.map((lead) => (lead.id === body.id ? body : lead)));
      toast({ title: successTitle });
    } catch (err: any) {
      toast({ title: "Lead update failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusyLeadId(null);
    }
  }

  async function convertLead(leadId: string) {
    setBusyLeadId(leadId);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/create-client`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create client account.");
      toast({
        title: body.warning ? "Client created with warning" : "Client account created",
        description: body.warning ?? "Lead converted and linked to a client profile.",
      });
      loadData();
    } catch (err: any) {
      toast({ title: "Convert failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusyLeadId(null);
    }
  }

  /* ── Quote actions — same endpoints as v1 ─────────────────────────────── */
  async function sendQuote(quote: any) {
    const recipient = window.prompt("Send quote to email:", quote.client?.email ?? quote.lead?.email ?? "");
    if (!recipient) return;
    setBusyQuoteId(quote.id);
    const res = await fetch(`/api/admin/quotes/${quote.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipient }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyQuoteId(null);
    if (!res.ok) {
      toast({ title: "Send failed", description: body.error ?? "Could not send quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote sent", description: `Sent to ${recipient}` });
    loadData();
  }

  async function downloadQuotePdf(id: string) {
    const res = await fetch(`/api/admin/quotes/${id}/pdf`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not export PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  async function assignQuoteToClient() {
    if (!assignTarget) return;
    setAssigning(true);
    const res = await fetch(`/api/admin/quotes/${assignTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: assignClientId || null }),
    });
    const body = await res.json().catch(() => ({}));
    setAssigning(false);
    if (!res.ok) {
      toast({ title: "Assign failed", description: body.error ?? "Could not update quote.", variant: "destructive" });
      return;
    }
    toast({ title: assignClientId ? "Quote assigned to client" : "Quote unassigned" });
    setAssignTarget(null);
    loadData();
  }

  async function removeQuote() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/quotes/${deleteTarget.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote deleted" });
    setDeleteTarget(null);
    loadData();
  }

  const leadCounts = useMemo(() => {
    return leads.reduce<Record<string, number>>((acc, lead) => {
      acc[lead.status] = (acc[lead.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [leads]);

  return (
    <div className="space-y-5">
      {/* Chip tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-0.5">
          {([
            ["leads", `Leads (${leads.length})`],
            ["quotes", `Quotes (${quotes.length})`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-[var(--e-radius-pill)] px-4 py-1.5 text-[0.8125rem] font-[550] transition-colors ${
                tab === value
                  ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "leads" ? (
          <div className="flex flex-wrap gap-1.5">
            {LEAD_STATUSES.map((status) => (
              <EBadge key={status} tone={LEAD_TONES[status] ?? "neutral"}>
                {prettify(status)} {leadCounts[status] ?? 0}
              </EBadge>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading pipeline…</p>
      ) : tab === "leads" ? (
        /* ── Leads: Estate cards ──────────────────────────────────────────── */
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {leads.map((lead) => (
            <ECard key={lead.id} className="flex flex-col">
              <ECardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <ECardTitle className="e-serif min-w-0 truncate text-[1.0625rem]">{lead.name}</ECardTitle>
                  <EBadge tone={LEAD_TONES[lead.status] ?? "neutral"} soft>
                    {prettify(lead.status)}
                  </EBadge>
                </div>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {prettify(lead.serviceType)} · {lead.suburb || "Suburb pending"} ·{" "}
                  {format(new Date(lead.createdAt), "dd MMM yyyy")}
                </p>
              </ECardHeader>
              <ECardBody className="flex flex-1 flex-col gap-3 pt-0">
                <div className="space-y-1.5 text-[0.8125rem]">
                  <p className="flex items-center gap-2 text-[hsl(var(--e-text-secondary))]">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-text-faint))]" />
                    <a href={`mailto:${lead.email}`} className="truncate hover:text-[hsl(var(--e-foreground))]">
                      {lead.email}
                    </a>
                  </p>
                  {lead.phone ? (
                    <p className="flex items-center gap-2 text-[hsl(var(--e-text-secondary))]">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-text-faint))]" />
                      <a href={`tel:${lead.phone}`} className="hover:text-[hsl(var(--e-foreground))]">{lead.phone}</a>
                    </p>
                  ) : null}
                </div>
                {lead.estimateMin || lead.estimateMax ? (
                  <div>
                    <EEyebrow>Estimate</EEyebrow>
                    <p className="e-numeral mt-1 text-[1.25rem] leading-none">
                      {formatCurrency(Number(lead.estimateMin ?? 0))} – {formatCurrency(Number(lead.estimateMax ?? 0))}
                    </p>
                  </div>
                ) : null}
                <EThread className="my-1" />
                <div className="mt-auto space-y-2">
                  <select
                    className={INPUT_CLS}
                    value={lead.status}
                    disabled={busyLeadId === lead.id}
                    onChange={(event) => void patchLead(lead.id, { status: event.target.value }, "Lead updated")}
                    aria-label="Lead status"
                  >
                    {LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {prettify(status)}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    {lead.clientId ? (
                      <EButton asChild variant="outline" size="sm" className="flex-1">
                        <Link href={`/v2/admin/clients/${lead.clientId}`}>View client</Link>
                      </EButton>
                    ) : (
                      <EButton
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        disabled={busyLeadId === lead.id}
                        onClick={() => void convertLead(lead.id)}
                      >
                        <UserRoundPlus className="h-3.5 w-3.5" />
                        {busyLeadId === lead.id ? "Working…" : "Convert"}
                      </EButton>
                    )}
                    {lead.status !== "LOST" ? (
                      <EButton
                        variant="ghost"
                        size="sm"
                        disabled={busyLeadId === lead.id}
                        onClick={() => void patchLead(lead.id, { status: "LOST" }, "Lead dismissed")}
                      >
                        Dismiss
                      </EButton>
                    ) : null}
                  </div>
                </div>
              </ECardBody>
            </ECard>
          ))}
          {leads.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3">
              <EEmptyState
                eyebrow="Pipeline"
                title="No leads yet"
                description="Requests from the public quote page will appear here."
              />
            </div>
          ) : null}
        </div>
      ) : (
        /* ── Quotes: Estate table ─────────────────────────────────────────── */
        <ECard>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.8125rem]">
              <thead>
                <tr className="border-b border-[hsl(var(--e-border))]">
                  {["Client", "Service", "Total", "Status", "Date", ""].map((head, index) => (
                    <th
                      key={index}
                      className="px-5 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-[hsl(var(--e-border))] last:border-0 hover:bg-[hsl(var(--e-muted))]"
                  >
                    <td className="px-5 py-3 font-[550]">
                      {quote.client?.name ?? quote.lead?.name ?? "Direct quote"}
                      {!quote.clientId && quote.lead?.name ? (
                        <span className="ml-1.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">lead</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-[hsl(var(--e-text-secondary))]">{prettify(quote.serviceType)}</td>
                    <td className="e-numeral whitespace-nowrap px-5 py-3 text-[0.9375rem]">
                      {formatCurrency(Number(quote.totalAmount ?? 0))}
                    </td>
                    <td className="px-5 py-3">
                      <EBadge tone={QUOTE_TONES[quote.status] ?? "neutral"} soft>
                        {prettify(quote.status)}
                      </EBadge>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-[hsl(var(--e-muted-foreground))]">
                      {format(new Date(quote.createdAt), "dd MMM yyyy")}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <EButton asChild variant="ghost" size="sm">
                          <Link href={`/v2/admin/quotes/${quote.id}`}>View</Link>
                        </EButton>
                        <EButton variant="ghost" size="sm" onClick={() => void downloadQuotePdf(quote.id)}>
                          <Download className="h-3.5 w-3.5" /> PDF
                        </EButton>
                        <EButton
                          variant="ghost"
                          size="sm"
                          disabled={busyQuoteId === quote.id}
                          onClick={() => void sendQuote(quote)}
                        >
                          <Send className="h-3.5 w-3.5" /> Email
                        </EButton>
                        <EButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAssignTarget(quote);
                            setAssignClientId(quote.clientId ?? "");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" /> Assign
                        </EButton>
                        {quote.status !== "CONVERTED" ? (
                          <EButton asChild variant="outline" size="sm">
                            <Link href={`/admin/quotes/${quote.id}/convert`}>Convert</Link>
                          </EButton>
                        ) : null}
                        <EButton
                          variant="ghost"
                          size="sm"
                          className="text-[hsl(var(--e-danger))] hover:text-[hsl(var(--e-danger))]"
                          onClick={() => setDeleteTarget(quote)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </EButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {quotes.length === 0 ? (
            <EEmptyState
              eyebrow="Quotes"
              title="No quotes yet"
              description="Create one in the classic builder or send a counter offer from a lead."
              className="border-0"
            />
          ) : null}
        </ECard>
      )}

      {/* Assign-to-client modal */}
      <EModal
        open={Boolean(assignTarget)}
        onClose={() => setAssignTarget(null)}
        title="Assign quote to client"
      >
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Addresses the quote to a client — they can view and accept it from their portal.
          </p>
          <select
            className={INPUT_CLS}
            value={assignClientId}
            onChange={(event) => setAssignClientId(event.target.value)}
            aria-label="Client"
          >
            <option value="">
              Unassigned{assignTarget?.lead?.name ? ` (lead: ${assignTarget.lead.name})` : ""}
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
                {client.email ? ` — ${client.email}` : ""}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setAssignTarget(null)} disabled={assigning}>
              Cancel
            </EButton>
            <EButton variant="primary" size="sm" onClick={() => void assignQuoteToClient()} disabled={assigning}>
              {assigning ? "Saving…" : "Save"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Delete confirm modal */}
      <EModal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete quote">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            This permanently removes the quote for{" "}
            <span className="font-[550] text-[hsl(var(--e-foreground))]">
              {deleteTarget?.client?.name ?? deleteTarget?.lead?.name ?? "this record"}
            </span>{" "}
            ({formatCurrency(Number(deleteTarget?.totalAmount ?? 0))}).
          </p>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </EButton>
            <EButton variant="danger" size="sm" onClick={() => void removeQuote()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete quote"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
