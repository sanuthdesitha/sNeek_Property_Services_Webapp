"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { addDays, format } from "date-fns";
import { Plus, Pencil, Trash2, Copy, Mail, Phone, Send, UserRoundPlus, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, "secondary" | "default" | "success" | "destructive" | "outline"> = {
  DRAFT: "secondary",
  SENT: "default",
  ACCEPTED: "success",
  DECLINED: "destructive",
  CONVERTED: "outline",
};

const LEAD_STATUS_COLORS: Record<string, "secondary" | "default" | "success" | "destructive" | "outline"> = {
  NEW: "secondary",
  CONTACTED: "default",
  QUOTED: "outline",
  CONVERTED: "success",
  LOST: "destructive",
};

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function extractPhotoUrls(structuredContext: any) {
  const candidates = [
    structuredContext?.photoUrls,
    structuredContext?.photos,
    structuredContext?.imageUrls,
    structuredContext?.images,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object" && typeof item.url === "string") return item.url.trim();
          return "";
        })
        .filter(Boolean);
    }
  }
  return [] as string[];
}

function buildLeadTimeline(lead: any) {
  if (!lead) return [] as Array<{ at: string; label: string }>;
  const events: Array<{ at: string; label: string }> = [
    { at: lead.createdAt, label: "Lead created" },
    { at: lead.updatedAt, label: `Lead ${prettify(lead.status).toLowerCase()}` },
  ];
  for (const quote of lead.quotes ?? []) {
    events.push({ at: quote.createdAt, label: `Quote ${String(quote.id).slice(-6)} created (${prettify(quote.status)})` });
    events.push({ at: quote.updatedAt, label: `Quote ${String(quote.id).slice(-6)} updated (${prettify(quote.status)})` });
  }
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function midpointEstimate(lead: any) {
  if (!lead) return 0;
  const min = Number(lead.estimateMin ?? 0);
  const max = Number(lead.estimateMax ?? min);
  if (min > 0 && max > 0) return Number(((min + max) / 2).toFixed(2));
  return Number((max || min || 0).toFixed(2));
}

export default function QuotesPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [leadDraft, setLeadDraft] = useState({ status: "NEW", notes: "" });
  const [updatingLead, setUpdatingLead] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [counterOfferOpen, setCounterOfferOpen] = useState(false);
  const [sendingCounterOffer, setSendingCounterOffer] = useState(false);
  const [counterOfferLines, setCounterOfferLines] = useState<
    Array<{ label: string; unitPrice: string; qty: string; total: string }>
  >([]);
  const [counterOfferNotes, setCounterOfferNotes] = useState("");
  const [counterOfferValidUntil, setCounterOfferValidUntil] = useState(
    format(addDays(new Date(), 7), "yyyy-MM-dd")
  );
  const [counterOfferSendEmail, setCounterOfferSendEmail] = useState(true);
  const [editQuote, setEditQuote] = useState<any | null>(null);
  const [savingQuote, setSavingQuote] = useState(false);
  const [deleteQuote, setDeleteQuote] = useState<any | null>(null);
  const [deletingQuote, setDeletingQuote] = useState(false);
  const [cloningQuoteId, setCloningQuoteId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    status: "DRAFT",
    validUntil: "",
    notes: "",
  });
  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId]
  );
  const leadPhotoUrls = useMemo(() => extractPhotoUrls(selectedLead?.structuredContext), [selectedLead]);
  const leadTimeline = useMemo(() => buildLeadTimeline(selectedLead), [selectedLead]);

  function loadData() {
    fetch("/api/admin/leads")
      .then((r) => r.json())
      .then((data) => setLeads(Array.isArray(data) ? data : []));

    fetch("/api/admin/quotes")
      .then((r) => r.json())
      .then((data) => setQuotes(Array.isArray(data) ? data : []));
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedLead) return;
    setLeadDraft({
      status: selectedLead.status ?? "NEW",
      notes: selectedLead.notes ?? "",
    });
  }, [selectedLead]);

  useEffect(() => {
    if (!editQuote) return;
    setEditForm({
      status: editQuote.status ?? "DRAFT",
      validUntil: editQuote.validUntil ? new Date(editQuote.validUntil).toISOString().slice(0, 10) : "",
      notes: editQuote.notes ?? "",
    });
  }, [editQuote]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: `Could not copy ${label.toLowerCase()}.`, variant: "destructive" });
    }
  }

  async function saveLeadPatch(
    patch: Partial<{ status: string; notes: string; clientId: string | null }>,
    successTitle?: string
  ) {
    if (!selectedLead) return null;
    setUpdatingLead(true);
    try {
      const res = await fetch(`/api/admin/leads/${selectedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update lead.");
      setLeads((current) => current.map((lead) => (lead.id === body.id ? body : lead)));
      if (successTitle) toast({ title: successTitle });
      return body;
    } catch (err: any) {
      toast({ title: "Lead update failed", description: err.message ?? "Try again.", variant: "destructive" });
      return null;
    } finally {
      setUpdatingLead(false);
    }
  }

  async function sendQuote(id: string, defaultEmail?: string | null) {
    const recipient = window.prompt("Send quote to email:", defaultEmail ?? "");
    if (!recipient) return;

    const res = await fetch(`/api/admin/quotes/${id}/send`, {
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
    loadData();
  }

  function openCounterOfferModal() {
    if (!selectedLead) return;
    const estimate = midpointEstimate(selectedLead);
    setCounterOfferLines([
      {
        label: selectedLead.requestedServiceLabel?.trim() || prettify(selectedLead.serviceType),
        unitPrice: estimate > 0 ? estimate.toFixed(2) : "0.00",
        qty: "1",
        total: estimate > 0 ? estimate.toFixed(2) : "0.00",
      },
    ]);
    setCounterOfferNotes(selectedLead.notes ?? "");
    setCounterOfferValidUntil(format(addDays(new Date(), 7), "yyyy-MM-dd"));
    setCounterOfferSendEmail(true);
    setCounterOfferOpen(true);
  }

  function updateCounterLine(index: number, patch: Partial<{ label: string; unitPrice: string; qty: string; total: string }>) {
    setCounterOfferLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, ...patch };
        const qty = Number(next.qty || 0);
        const unitPrice = Number(next.unitPrice || 0);
        if (patch.qty !== undefined || patch.unitPrice !== undefined) {
          next.total = Number.isFinite(qty * unitPrice) ? (qty * unitPrice).toFixed(2) : line.total;
        }
        return next;
      })
    );
  }

  async function submitCounterOffer() {
    if (!selectedLead) return;
    const lineItems = counterOfferLines
      .map((line) => ({
        label: line.label.trim(),
        unitPrice: Number(line.unitPrice || 0),
        qty: Number(line.qty || 0),
        total: Number(line.total || 0),
      }))
      .filter((line) => line.label && Number.isFinite(line.unitPrice) && Number.isFinite(line.qty) && line.qty > 0);

    if (lineItems.length === 0) {
      toast({ title: "Add at least one line item.", variant: "destructive" });
      return;
    }

    setSendingCounterOffer(true);
    try {
      const res = await fetch(`/api/admin/leads/${selectedLead.id}/counter-offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems,
          notes: counterOfferNotes || undefined,
          validUntil: counterOfferValidUntil ? new Date(`${counterOfferValidUntil}T00:00:00`).toISOString() : undefined,
          sendEmail: counterOfferSendEmail,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send counter offer.");
      toast({ title: counterOfferSendEmail ? "Counter offer sent" : "Counter offer saved as draft" });
      setCounterOfferOpen(false);
      loadData();
    } catch (err: any) {
      toast({ title: "Counter offer failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setSendingCounterOffer(false);
    }
  }

  async function createClientFromLead() {
    if (!selectedLead) return;
    setCreatingClient(true);
    try {
      const res = await fetch(`/api/admin/leads/${selectedLead.id}/create-client`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create client account.");
      toast({
        title: body.warning ? "Client created with warning" : "Client account created",
        description: body.warning ?? "The lead has been converted and linked to a client profile.",
      });
      loadData();
    } catch (err: any) {
      toast({ title: "Create client failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setCreatingClient(false);
    }
  }

  async function updateQuote() {
    if (!editQuote) return;
    setSavingQuote(true);
    const payload = {
      status: editForm.status,
      notes: editForm.notes || null,
      validUntil: editForm.validUntil ? new Date(`${editForm.validUntil}T00:00:00`).toISOString() : null,
    };
    const res = await fetch(`/api/admin/quotes/${editQuote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingQuote(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote updated" });
    setEditQuote(null);
    loadData();
  }

  async function cloneQuote(quote: any) {
    setCloningQuoteId(quote.id);
    const payload = {
      leadId: quote.leadId || undefined,
      clientId: quote.clientId || undefined,
      serviceType: quote.serviceType,
      lineItems: Array.isArray(quote.lineItems) ? quote.lineItems : [],
      subtotal: Number(quote.subtotal ?? 0),
      gstAmount: Number(quote.gstAmount ?? 0),
      totalAmount: Number(quote.totalAmount ?? 0),
      notes: quote.notes ?? undefined,
      validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : undefined,
    };
    const res = await fetch("/api/admin/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setCloningQuoteId(null);
    if (!res.ok) {
      toast({ title: "Clone failed", description: body.error ?? "Could not clone quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote template copy created" });
    loadData();
  }

  async function removeQuote() {
    if (!deleteQuote) return;
    setDeletingQuote(true);
    const res = await fetch(`/api/admin/quotes/${deleteQuote.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingQuote(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote deleted" });
    setDeleteQuote(null);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Quotes and Leads</h2>
        <Button asChild>
          <Link href="/admin/quotes/new">
            <Plus className="mr-2 h-4 w-4" />
            New Quote
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads ({leads.length})</TabsTrigger>
          <TabsTrigger value="quotes">Quotes ({quotes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {leads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition hover:bg-muted/40"
                    onClick={() => setSelectedLeadId(lead.id)}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{lead.name}</p>
                        <Badge variant={LEAD_STATUS_COLORS[lead.status] ?? "secondary"} className="text-xs">
                          {prettify(lead.status)}
                        </Badge>
                        {lead.clientId ? <Badge variant="success">Linked client</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {lead.email} · {prettify(lead.serviceType)} · {lead.suburb || "Suburb pending"}
                      </p>
                      {lead.estimateMin || lead.estimateMax ? (
                        <p className="text-xs text-muted-foreground">
                          Estimate {formatCurrency(Number(lead.estimateMin ?? 0))} - {formatCurrency(Number(lead.estimateMax ?? 0))}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{format(new Date(lead.createdAt), "dd MMM yyyy")}</p>
                      <p>{(lead.quotes ?? []).length} quote{(lead.quotes ?? []).length === 1 ? "" : "s"}</p>
                    </div>
                  </button>
                ))}
                {leads.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No leads yet. They will appear here from the public quote page.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotes">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {quotes.map((q) => (
                  <div key={q.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <p className="text-sm font-medium">{q.client?.name ?? q.lead?.name ?? "Direct quote"}</p>
                      <p className="text-xs text-muted-foreground">
                        {q.serviceType?.replace(/_/g, " ")} - {format(new Date(q.createdAt), "dd MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{formatCurrency(q.totalAmount)}</span>
                      <Button size="sm" variant="outline" onClick={() => downloadQuotePdf(q.id)}>
                        PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendQuote(q.id, q.client?.email ?? q.lead?.email ?? null)}
                      >
                        Email
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditQuote(q)}>
                        <Pencil className="mr-1 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cloningQuoteId === q.id}
                        onClick={() => cloneQuote(q)}
                      >
                        <Copy className="mr-1 h-4 w-4" />
                        {cloningQuoteId === q.id ? "Saving..." : "Save as template"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteQuote(q)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Delete
                      </Button>
                      {q.status !== "CONVERTED" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/quotes/${q.id}/convert`}>Convert</Link>
                        </Button>
                      )}
                      <Badge variant={STATUS_COLORS[q.status] ?? "secondary"}>{q.status}</Badge>
                      {q.status === "DRAFT" && (
                        <span className="text-xs text-muted-foreground">Pending admin approval</span>
                      )}
                    </div>
                  </div>
                ))}
                {quotes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No quotes yet.</p> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedLead ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/35" onClick={() => setSelectedLeadId("")} />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-semibold">{selectedLead.name}</h3>
                  <Badge variant={LEAD_STATUS_COLORS[selectedLead.status] ?? "secondary"}>{prettify(selectedLead.status)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{prettify(selectedLead.serviceType)} · {selectedLead.suburb || "Suburb pending"}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setSelectedLeadId("")}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <section className="space-y-3 rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Contact</p>
                  {selectedLead.clientId ? <Badge variant="success">Linked client</Badge> : null}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="truncate">{selectedLead.email}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => void copyText(selectedLead.email, "Email")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" asChild>
                        <a href={`mailto:${selectedLead.email}`}>
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </div>
                  {selectedLead.phone ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/30 px-3 py-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        <p>{selectedLead.phone}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => void copyText(selectedLead.phone || "", "Phone")}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" asChild>
                          <a href={`tel:${selectedLead.phone}`}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p>{selectedLead.address || "Address pending"}</p>
                    {selectedLead.suburb ? <p className="text-xs text-muted-foreground">{selectedLead.suburb}</p> : null}
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border p-4">
                <p className="text-sm font-semibold">Property</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Bedrooms</p>
                    <p>{selectedLead.bedrooms ?? "-"}</p>
                  </div>
                  <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Bathrooms</p>
                    <p>{selectedLead.bathrooms ?? "-"}</p>
                  </div>
                  <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Balcony</p>
                    <p>{selectedLead.hasBalcony ? "Yes" : "No"}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border p-4">
                <p className="text-sm font-semibold">Quote estimate</p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(Number(selectedLead.estimateMin ?? 0))} - {formatCurrency(Number(selectedLead.estimateMax ?? 0))}
                </p>
                {selectedLead.promoCode ? <p className="text-xs text-muted-foreground">Promo code: {selectedLead.promoCode}</p> : null}
              </section>

              {leadPhotoUrls.length > 0 ? (
                <section className="space-y-3 rounded-2xl border p-4">
                  <p className="text-sm font-semibold">Photos</p>
                  <div className="grid grid-cols-3 gap-2">
                    {leadPhotoUrls.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border">
                        <img src={url} alt="Lead reference" className="h-24 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-3 rounded-2xl border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select
                      value={leadDraft.status}
                      onValueChange={async (value) => {
                        setLeadDraft((current) => ({ ...current, status: value }));
                        await saveLeadPatch({ status: value }, "Lead updated");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["NEW", "CONTACTED", "QUOTED", "CONVERTED", "LOST"].map((status) => (
                          <SelectItem key={status} value={status}>
                            {prettify(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-xl bg-muted/30 px-3 py-3 text-sm">
                    <p className="text-xs text-muted-foreground">Requested service</p>
                    <p>{selectedLead.requestedServiceLabel?.trim() || prettify(selectedLead.serviceType)}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Admin notes</Label>
                  <Textarea
                    rows={5}
                    value={leadDraft.notes}
                    onChange={(event) => setLeadDraft((current) => ({ ...current, notes: event.target.value }))}
                    onBlur={async () => {
                      if ((selectedLead.notes ?? "") === leadDraft.notes) return;
                      await saveLeadPatch({ notes: leadDraft.notes }, "Lead notes saved");
                    }}
                    placeholder="Internal lead notes"
                  />
                  {updatingLead ? <p className="text-xs text-muted-foreground">Saving...</p> : null}
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border p-4">
                <p className="text-sm font-semibold">Timeline</p>
                <div className="space-y-2">
                  {leadTimeline.map((item, index) => (
                    <div key={`${item.at}-${index}`} className="rounded-xl bg-muted/30 px-3 py-2 text-sm">
                      <p>{item.label}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(item.at), "dd MMM yyyy HH:mm")}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="border-t bg-background px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button onClick={openCounterOfferModal} className="flex-1">
                  <Send className="mr-2 h-4 w-4" />
                  Send counter offer
                </Button>
                {selectedLead.clientId ? (
                  <Button variant="outline" asChild className="flex-1">
                    <Link href={`/admin/clients/${selectedLead.clientId}`}>View client</Link>
                  </Button>
                ) : (
                  <Button variant="outline" onClick={createClientFromLead} disabled={creatingClient} className="flex-1">
                    <UserRoundPlus className="mr-2 h-4 w-4" />
                    {creatingClient ? "Creating..." : "Create client account"}
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      <Dialog open={counterOfferOpen} onOpenChange={setCounterOfferOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Counter offer for {selectedLead?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{prettify(selectedLead?.serviceType)}</Badge>
              {selectedLead?.requestedServiceLabel ? <Badge variant="secondary">{selectedLead.requestedServiceLabel}</Badge> : null}
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="grid grid-cols-[1.6fr_0.8fr_0.6fr_0.8fr_56px] gap-2 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Description</span>
                <span>Unit price</span>
                <span>Qty</span>
                <span>Total</span>
                <span />
              </div>
              <div className="space-y-2 p-3">
                {counterOfferLines.map((line, index) => (
                  <div key={index} className="grid grid-cols-[1.6fr_0.8fr_0.6fr_0.8fr_56px] gap-2">
                    <Input value={line.label} onChange={(event) => updateCounterLine(index, { label: event.target.value })} />
                    <Input type="number" step="0.01" value={line.unitPrice} onChange={(event) => updateCounterLine(index, { unitPrice: event.target.value })} />
                    <Input type="number" step="0.1" value={line.qty} onChange={(event) => updateCounterLine(index, { qty: event.target.value })} />
                    <Input type="number" step="0.01" value={line.total} onChange={(event) => updateCounterLine(index, { total: event.target.value })} />
                    <Button variant="ghost" size="icon" onClick={() => setCounterOfferLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCounterOfferLines((current) => [...current, { label: "", unitPrice: "0.00", qty: "1", total: "0.00" }])}>
                <Plus className="mr-2 h-4 w-4" />
                Add row
              </Button>
              <div className="text-sm font-medium">
                Total {formatCurrency(counterOfferLines.reduce((sum, line) => sum + Number(line.total || 0), 0) * 1.1)}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Valid until</Label>
                <Input type="date" value={counterOfferValidUntil} onChange={(event) => setCounterOfferValidUntil(event.target.value)} />
              </div>
              <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                <span>Send email to client now</span>
                <input type="checkbox" checked={counterOfferSendEmail} onChange={(event) => setCounterOfferSendEmail(event.target.checked)} />
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={4} value={counterOfferNotes} onChange={(event) => setCounterOfferNotes(event.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCounterOfferOpen(false)} disabled={sendingCounterOffer}>
                Cancel
              </Button>
              <Button onClick={submitCounterOffer} disabled={sendingCounterOffer}>
                {sendingCounterOffer ? "Sending..." : counterOfferSendEmail ? "Send offer" : "Save offer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editQuote)} onOpenChange={(open) => !open && setEditQuote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(STATUS_COLORS).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valid until</Label>
              <Input
                type="date"
                value={editForm.validUntil}
                onChange={(e) => setEditForm((prev) => ({ ...prev, validUntil: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditQuote(null)} disabled={savingQuote}>
                Cancel
              </Button>
              <Button onClick={updateQuote} disabled={savingQuote}>
                {savingQuote ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={Boolean(deleteQuote)}
        onOpenChange={(open) => !open && setDeleteQuote(null)}
        title="Delete quote"
        description="This permanently removes the quote record."
        actionKey="deleteQuote"
        confirmLabel="Delete quote"
        loading={deletingQuote}
        onConfirm={removeQuote}
      />
    </div>
  );
}

