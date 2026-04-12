"use client";

import { useEffect, useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import {
  Check,
  ChevronRight,
  Download,
  FileText,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";
import { cn } from "@/lib/utils";

// ── types ──────────────────────────────────────────────────────────────────────

type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category: string;
  job: { id: string; jobNumber: string | null; scheduledDate: string; property: { name: string; suburb: string } } | null;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: "DRAFT" | "APPROVED" | "SENT" | "PAID" | "VOID";
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  periodStart: string | null;
  periodEnd: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  client: { id: string; name: string; email: string };
  lines: InvoiceLine[];
};

type Client = { id: string; name: string; email: string };
type Property = { id: string; name: string; suburb: string; clientId: string };
type Rate = { id: string; jobType: string; baseCharge: number; property: { id: string; name: string; client: { name: string } | null } };

const JOB_TYPES = [
  "AIRBNB_TURNOVER", "DEEP_CLEAN", "END_OF_LEASE", "GENERAL_CLEAN",
  "POST_CONSTRUCTION", "PRESSURE_WASH", "WINDOW_CLEAN", "LAWN_MOWING",
  "SPECIAL_CLEAN", "COMMERCIAL_RECURRING",
];

const STATUS_CONFIG = {
  DRAFT:    { label: "Draft",    color: "bg-amber-100 text-amber-800 border-amber-200" },
  APPROVED: { label: "Approved", color: "bg-blue-100 text-blue-800 border-blue-200" },
  SENT:     { label: "Sent",     color: "bg-sky-100 text-sky-800 border-sky-200" },
  PAID:     { label: "Paid",     color: "bg-green-100 text-green-800 border-green-200" },
  VOID:     { label: "Void",     color: "bg-gray-100 text-gray-500 border-gray-200" },
} as const;

function money(v: number | null | undefined) {
  return `$${Number(v ?? 0).toFixed(2)}`;
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(new Date(v), "dd MMM yyyy"); } catch { return v; }
}
function fmtDateFull(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(new Date(v), "dd MMM yyyy HH:mm"); } catch { return v; }
}

// ── main page ──────────────────────────────────────────────────────────────────

export function ClientInvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Generate dialog
  const [showGenerate, setShowGenerate] = useState(false);
  const [genClientId, setGenClientId] = useState("");
  const [genPropertyId, setGenPropertyId] = useState("");
  const [genPeriodStart, setGenPeriodStart] = useState("");
  const [genPeriodEnd, setGenPeriodEnd] = useState("");

  // Rate dialog
  const [showRates, setShowRates] = useState(false);
  const [ratePropertyId, setRatePropertyId] = useState("");
  const [rateJobType, setRateJobType] = useState("AIRBNB_TURNOVER");
  const [rateAmount, setRateAmount] = useState("");
  const [rateDesc, setRateDesc] = useState("");

  // Line edit state
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineEditDesc, setLineEditDesc] = useState("");
  const [lineEditQty, setLineEditQty] = useState("1");
  const [lineEditRate, setLineEditRate] = useState("0");

  // Add line dialog
  const [showAddLine, setShowAddLine] = useState(false);
  const [addLineDesc, setAddLineDesc] = useState("");
  const [addLineQty, setAddLineQty] = useState("1");
  const [addLineRate, setAddLineRate] = useState("0");

  // Send dialog
  const [showSend, setShowSend] = useState(false);
  const [sendEmail, setSendEmail] = useState("");

  // Status filter
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [searchQ, setSearchQ] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/invoices");
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { toast({ title: "Load failed", variant: "destructive" }); return; }
    setClients(body.clients ?? []);
    setProperties(body.properties ?? []);
    setRates(body.rates ?? []);
    setInvoices(body.invoices ?? []);
    if (!genClientId && body.clients?.[0]) setGenClientId(body.clients[0].id);
    if (!ratePropertyId && body.properties?.[0]) setRatePropertyId(body.properties[0].id);
  }

  async function loadInvoice(id: string) {
    const res = await fetch(`/api/admin/invoices/${id}`);
    const body = await res.json().catch(() => null);
    if (res.ok && body) setSelected(body);
  }

  useEffect(() => { load(); }, []);

  const filteredInvoices = useMemo(() => {
    let list = invoices;
    if (statusFilter === "active") list = list.filter((i) => i.status !== "VOID");
    else if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter((i) =>
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.client.name.toLowerCase().includes(q) ||
        i.client.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [invoices, statusFilter, searchQ]);

  const visibleProperties = useMemo(
    () => properties.filter((p) => !genClientId || p.clientId === genClientId),
    [properties, genClientId]
  );

  async function patch(id: string, data: object, successMsg: string) {
    setBusy(id);
    const res = await fetch(`/api/admin/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { toast({ title: "Failed", description: body.error, variant: "destructive" }); return false; }
    toast({ title: successMsg });
    await load();
    if (selected?.id === id) await loadInvoice(id);
    return true;
  }

  async function generateInvoice() {
    if (!genClientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    setBusy("generate");
    const res = await fetch("/api/admin/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: genClientId,
        propertyId: genPropertyId || undefined,
        periodStart: genPeriodStart ? `${genPeriodStart}T00:00:00.000Z` : undefined,
        periodEnd: genPeriodEnd ? `${genPeriodEnd}T23:59:59.999Z` : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { toast({ title: "Generate failed", description: body.error, variant: "destructive" }); return; }
    toast({ title: "Invoice draft created" });
    setShowGenerate(false);
    await load();
    await loadInvoice(body.id);
    setSelected(body);
  }

  async function saveRate() {
    if (!ratePropertyId || !rateAmount) { toast({ title: "Property and amount required", variant: "destructive" }); return; }
    setBusy("rate");
    const res = await fetch("/api/admin/property-client-rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: ratePropertyId, jobType: rateJobType, baseCharge: Number(rateAmount), defaultDescription: rateDesc || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { toast({ title: "Rate save failed", description: body.error, variant: "destructive" }); return; }
    toast({ title: "Rate saved" });
    await load();
  }

  async function sendInvoice() {
    if (!selected) return;
    setBusy("send");
    const res = await fetch(`/api/admin/invoices/${selected.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendEmail ? { to: sendEmail } : {}),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { toast({ title: "Send failed", description: body.error, variant: "destructive" }); return; }
    toast({ title: "Invoice sent" });
    setShowSend(false);
    setSendEmail("");
    await load();
    await loadInvoice(selected.id);
  }

  async function deleteInvoice(id: string) {
    setBusy(`delete-${id}`);
    const res = await fetch(`/api/admin/invoices/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { toast({ title: "Delete failed", variant: "destructive" }); return; }
    toast({ title: "Invoice deleted" });
    if (selected?.id === id) setSelected(null);
    await load();
  }

  async function saveLine(invoiceId: string, lineId: string) {
    const unitPrice = Number(lineEditRate);
    const quantity = Number(lineEditQty);
    if (!Number.isFinite(unitPrice) || !Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: "Invalid values", variant: "destructive" }); return;
    }
    const ok = await patch(invoiceId, {
      updateLines: [{ id: lineId, description: lineEditDesc, quantity, unitPrice }]
    }, "Line updated");
    if (ok) setEditingLineId(null);
  }

  async function addLine(invoiceId: string) {
    const unitPrice = Number(addLineRate);
    const quantity = Number(addLineQty);
    if (!addLineDesc.trim() || !Number.isFinite(unitPrice) || !Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: "Fill in all fields", variant: "destructive" }); return;
    }
    const ok = await patch(invoiceId, {
      addLine: { description: addLineDesc.trim(), quantity, unitPrice, category: "SERVICE" }
    }, "Line added");
    if (ok) { setShowAddLine(false); setAddLineDesc(""); setAddLineQty("1"); setAddLineRate("0"); }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: invoices.length, active: 0 };
    for (const inv of invoices) {
      counts[inv.status] = (counts[inv.status] ?? 0) + 1;
      if (inv.status !== "VOID") counts.active++;
    }
    return counts;
  }, [invoices]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Invoices</h2>
          <p className="text-sm text-muted-foreground">Generate, approve, and send client invoices with payment details.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowRates(true)}>
            Billing rates
          </Button>
          <Button onClick={() => setShowGenerate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Generate invoice
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Invoice list */}
        <div className="space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: "active", label: "Active" },
              { key: "DRAFT", label: "Draft" },
              { key: "APPROVED", label: "Approved" },
              { key: "SENT", label: "Sent" },
              { key: "PAID", label: "Paid" },
              { key: "all", label: "All" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  statusFilter === key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                )}
              >
                {label}
                {statusCounts[key] != null ? ` (${statusCounts[key]})` : ""}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search by client or invoice #…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="h-9 text-sm"
          />
          <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : filteredInvoices.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No invoices found.</p>
            ) : (
              filteredInvoices.map((inv) => {
                const cfg = STATUS_CONFIG[inv.status];
                return (
                  <button
                    key={inv.id}
                    onClick={() => loadInvoice(inv.id)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                      selected?.id === inv.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{inv.invoiceNumber}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", cfg.color)}>{cfg.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{inv.client.name}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{fmtDate(inv.createdAt)}</span>
                      <span className="text-sm font-semibold">{money(inv.totalAmount)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Invoice detail */}
        <div>
          {!selected ? (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
              <div className="text-center">
                <FileText className="mx-auto mb-3 h-8 w-8 opacity-30" />
                Select an invoice to view details
              </div>
            </div>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{selected.invoiceNumber}</CardTitle>
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-bold", STATUS_CONFIG[selected.status].color)}>
                        {STATUS_CONFIG[selected.status].label}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{selected.client.name} · {selected.client.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Status transitions */}
                    {selected.status === "DRAFT" && (
                      <Button size="sm" onClick={() => patch(selected.id, { status: "APPROVED" }, "Invoice approved")} disabled={busy === selected.id}>
                        <Check className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                    )}
                    {(selected.status === "DRAFT" || selected.status === "APPROVED") && (
                      <Button size="sm" variant="outline" onClick={() => { setShowSend(true); setSendEmail(selected.client.email ?? ""); }}>
                        <Send className="mr-1 h-3.5 w-3.5" /> Send to client
                      </Button>
                    )}
                    {selected.status === "SENT" && (
                      <Button size="sm" onClick={() => patch(selected.id, { status: "PAID" }, "Marked as paid")} disabled={busy === selected.id}>
                        <Check className="mr-1 h-3.5 w-3.5" /> Mark as paid
                      </Button>
                    )}
                    {selected.status !== "VOID" && selected.status !== "PAID" && (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive"
                        onClick={() => patch(selected.id, { status: "VOID" }, "Invoice voided")} disabled={busy === selected.id}>
                        Void
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => downloadFromApi(`/api/admin/invoices/${selected.id}/pdf`, `${selected.invoiceNumber.toLowerCase()}.pdf`)}>
                      <Download className="mr-1 h-3.5 w-3.5" /> PDF
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Delete this invoice?")) deleteInvoice(selected.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Meta row */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                  <div className="rounded-lg border p-2.5">
                    <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                    <p className="font-medium">{fmtDate(selected.createdAt)}</p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-xs text-muted-foreground mb-0.5">Period</p>
                    <p className="font-medium text-xs">
                      {selected.periodStart && selected.periodEnd
                        ? `${fmtDate(selected.periodStart)} – ${fmtDate(selected.periodEnd)}`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-xs text-muted-foreground mb-0.5">Sent</p>
                    <p className="font-medium text-xs">{selected.sentAt ? fmtDateFull(selected.sentAt) : "Not sent"}</p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-xs text-muted-foreground mb-0.5">Paid</p>
                    <p className="font-medium text-xs">{selected.paidAt ? fmtDate(selected.paidAt) : "Not paid"}</p>
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">Line items</p>
                    {selected.status === "DRAFT" && (
                      <Button size="sm" variant="outline" onClick={() => setShowAddLine(true)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add line
                      </Button>
                    )}
                  </div>
                  <div className="rounded-xl border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">Description</th>
                          <th className="px-3 py-2 text-right font-medium w-16">Qty</th>
                          <th className="px-3 py-2 text-right font-medium w-24">Rate</th>
                          <th className="px-3 py-2 text-right font-medium w-24">Total</th>
                          {selected.status === "DRAFT" && <th className="px-3 py-2 w-16" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {selected.lines.map((line) => (
                          <tr key={line.id} className={cn(editingLineId === line.id ? "bg-muted/30" : "hover:bg-muted/20")}>
                            {editingLineId === line.id ? (
                              <>
                                <td className="px-3 py-1.5">
                                  <Input className="h-7 text-xs" value={lineEditDesc} onChange={(e) => setLineEditDesc(e.target.value)} />
                                </td>
                                <td className="px-3 py-1.5">
                                  <Input className="h-7 text-xs w-16 text-right" type="number" min={0.01} step={0.5} value={lineEditQty} onChange={(e) => setLineEditQty(e.target.value)} />
                                </td>
                                <td className="px-3 py-1.5">
                                  <Input className="h-7 text-xs w-24 text-right" type="number" min={0} step={0.01} value={lineEditRate} onChange={(e) => setLineEditRate(e.target.value)} />
                                </td>
                                <td className="px-3 py-1.5 text-right text-xs font-medium">
                                  {money(Number(lineEditQty) * Number(lineEditRate))}
                                </td>
                                <td className="px-2 py-1.5">
                                  <div className="flex gap-1">
                                    <button onClick={() => saveLine(selected.id, line.id)} className="rounded p-1 hover:bg-green-100 text-green-700"><Check className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => setEditingLineId(null)} className="rounded p-1 hover:bg-muted text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2">
                                  <p className="font-medium">{line.description}</p>
                                  {line.job && (
                                    <p className="text-xs text-muted-foreground">
                                      {line.job.property.name} · #{line.job.jobNumber} · {fmtDate(line.job.scheduledDate)}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{line.quantity.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{money(line.unitPrice)}</td>
                                <td className="px-3 py-2 text-right font-semibold">{money(line.lineTotal)}</td>
                                {selected.status === "DRAFT" && (
                                  <td className="px-2 py-2">
                                    <div className="flex gap-1">
                                      <button onClick={() => { setEditingLineId(line.id); setLineEditDesc(line.description); setLineEditQty(String(line.quantity)); setLineEditRate(String(line.unitPrice)); }} className="rounded p-1 hover:bg-muted text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                                      <button onClick={() => patch(selected.id, { removeLineId: line.id }, "Line removed")} className="rounded p-1 hover:bg-red-100 text-destructive"><X className="h-3.5 w-3.5" /></button>
                                    </div>
                                  </td>
                                )}
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-64 space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span><span>{money(selected.subtotal)}</span>
                    </div>
                    {Number(selected.gstAmount) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>GST (10%)</span><span>{money(selected.gstAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2 text-base font-bold">
                      <span>Total (AUD)</span><span>{money(selected.totalAmount)}</span>
                    </div>
                    {selected.status === "PAID" && selected.paidAt && (
                      <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 font-medium text-center mt-1">
                        Paid {fmtDate(selected.paidAt)}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Generate dialog ── */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={genClientId} onValueChange={(v) => { setGenClientId(v); setGenPropertyId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Property <span className="text-muted-foreground">(optional — defaults to all)</span></Label>
              <Select value={genPropertyId || "__all__"} onValueChange={(v) => setGenPropertyId(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All properties" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All properties</SelectItem>
                  {visibleProperties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {p.suburb}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Period from</Label>
                <Input type="date" value={genPeriodStart} onChange={(e) => setGenPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Period to</Label>
                <Input type="date" value={genPeriodEnd} onChange={(e) => setGenPeriodEnd(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Generates lines for all completed jobs with billing rates set. Shopping reimbursements are included automatically.
            </p>
            <Button className="w-full" onClick={generateInvoice} disabled={busy === "generate" || !genClientId}>
              {busy === "generate" ? "Generating…" : "Generate draft invoice"}
              {busy !== "generate" && <ChevronRight className="ml-1 h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Send dialog ── */}
      <Dialog open={showSend} onOpenChange={setShowSend}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send invoice to client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The invoice PDF will be attached to the email. Payment details from your invoicing settings will be included.
            </p>
            <div className="space-y-1.5">
              <Label>Send to email</Label>
              <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder={selected?.client.email} />
              <p className="text-xs text-muted-foreground">Leave blank to use client's delivery profile.</p>
            </div>
            {selected && (
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-semibold">{selected.invoiceNumber}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span>{selected.client.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold">{money(selected.totalAmount)}</span></div>
              </div>
            )}
            <Button className="w-full" onClick={sendInvoice} disabled={busy === "send"}>
              <Mail className="mr-2 h-4 w-4" />
              {busy === "send" ? "Sending…" : "Send invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add line dialog ── */}
      <Dialog open={showAddLine} onOpenChange={setShowAddLine}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add line item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={addLineDesc} onChange={(e) => setAddLineDesc(e.target.value)} placeholder="e.g. Additional cleaning fee" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={0.01} step={0.5} value={addLineQty} onChange={(e) => setAddLineQty(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Unit price</Label>
                <Input type="number" min={0} step={0.01} value={addLineRate} onChange={(e) => setAddLineRate(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-between rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Line total</span>
              <span className="font-bold">{money(Number(addLineQty) * Number(addLineRate))}</span>
            </div>
            <Button className="w-full" onClick={() => selected && addLine(selected.id)} disabled={busy === selected?.id}>
              Add line
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Billing rates dialog ── */}
      <Dialog open={showRates} onOpenChange={setShowRates}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Billing rates</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Property</Label>
                <Select value={ratePropertyId} onValueChange={setRatePropertyId}>
                  <SelectTrigger><SelectValue placeholder="Select property…" /></SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Job type</Label>
                <Select value={rateJobType} onValueChange={setRateJobType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Base charge ($)</Label>
                <Input type="number" min={0} step={0.01} value={rateAmount} onChange={(e) => setRateAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Default description</Label>
                <Input value={rateDesc} onChange={(e) => setRateDesc(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <Button onClick={saveRate} disabled={busy === "rate"}>
              {busy === "rate" ? "Saving…" : "Save rate"}
            </Button>

            <div className="border-t pt-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Saved rates</p>
              {rates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rates saved yet.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {rates.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{r.property.name}</p>
                        <p className="text-xs text-muted-foreground">{r.property.client?.name} · {r.jobType.replace(/_/g, " ")}</p>
                      </div>
                      <span className="font-semibold">{money(r.baseCharge)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
