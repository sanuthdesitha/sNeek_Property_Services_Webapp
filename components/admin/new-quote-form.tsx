"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { JobType } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { calculateGstBreakdown, getGstDisplayLabel } from "@/lib/pricing/gst";
import { EXTRAS_CATALOG, EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";

type LineItem = { label: string; unitPrice: number; qty: number; total: number };
interface Option { id: string; name: string; email: string; }
interface ServiceOption {
  jobType: string;
  label: string;
  model: "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";
  itemLabel: string | null;
  unitLabel: string | null;
  bands: { label: string }[];
}
interface NewQuoteFormProps {
  leads: (Option & { serviceType?: JobType; bedrooms?: number | null; bathrooms?: number | null })[];
  clients: Option[];
  services: ServiceOption[];
  gstEnabled: boolean;
}

export function NewQuoteForm({ leads, clients, services, gstEnabled }: NewQuoteFormProps) {
  const router = useRouter();

  const [recipientMode, setRecipientMode] = useState<"client" | "lead" | "new">("client");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [newLead, setNewLead] = useState({ name: "", email: "", phone: "", suburb: "" });

  const [serviceType, setServiceType] = useState<string>(services[0]?.jobType ?? "AIRBNB_TURNOVER");
  const [bedrooms, setBedrooms] = useState("2");
  const [bathrooms, setBathrooms] = useState("1");
  const [sqm, setSqm] = useState("50");
  const [windows, setWindows] = useState("10");
  const [items, setItems] = useState("3");
  const [hours, setHours] = useState("3");
  const [bandIndex, setBandIndex] = useState("0");

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [pricing, setPricing] = useState(false);
  const [notes, setNotes] = useState("");
  const [validUntilDate, setValidUntilDate] = useState("");
  const [saving, setSaving] = useState(false);

  const service = useMemo(() => services.find((s) => s.jobType === serviceType) ?? services[0], [services, serviceType]);

  // Selected extras become their own line items (kept separate from the base so
  // they can flow to the job form as an "Additionals" section with how-to).
  const extraLines = useMemo<LineItem[]>(
    () =>
      selectedExtras
        .map((id) => EXTRAS_BY_ID[id])
        .filter(Boolean)
        .map((e) => ({ label: e.label, unitPrice: e.price, qty: 1, total: e.price })),
    [selectedExtras]
  );
  const allLines = useMemo(() => [...lineItems, ...extraLines], [lineItems, extraLines]);

  const { subtotal, gstAmount, totalAmount } = useMemo(() => {
    const sum = allLines.reduce((acc, li) => acc + (Number(li.total) || 0), 0);
    return calculateGstBreakdown(Math.max(0, Number(sum.toFixed(2))), { gstEnabled });
  }, [allLines, gstEnabled]);
  const gstLabel = useMemo(() => getGstDisplayLabel({ gstEnabled }), [gstEnabled]);

  function applyLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    if (lead.serviceType && services.some((s) => s.jobType === lead.serviceType)) setServiceType(lead.serviceType);
    if (lead.bedrooms != null) setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms != null) setBathrooms(String(lead.bathrooms));
  }

  function priceInputs() {
    const model = service?.model;
    return {
      serviceType,
      bedrooms: model === "ROOMS" ? Number(bedrooms) || 0 : undefined,
      bathrooms: model === "ROOMS" ? Number(bathrooms) || 0 : undefined,
      sqm: model === "AREA" || model === "ROOMS" ? Number(sqm) || 0 : undefined,
      windows: model === "WINDOWS" ? Number(windows) || 0 : undefined,
      items: model === "ITEMS" ? Number(items) || 0 : undefined,
      hours: model === "HOURLY" ? Number(hours) || 0 : undefined,
      bandIndex: model === "BANDS" ? Number(bandIndex) || 0 : undefined,
    };
  }

  async function autoPrice() {
    setPricing(true);
    try {
      const res = await fetch("/api/admin/quotes/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(priceInputs()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not price this quote.");
      if (body.requiresManualQuote) {
        toast({ title: "Manual quote needed", description: body.message ?? "Add line items by hand." });
        return;
      }
      const items: LineItem[] = Array.isArray(body.result?.lineItems) ? body.result.lineItems : [];
      if (items.length === 0) {
        toast({ title: "No price returned", description: "Add line items manually.", variant: "destructive" });
        return;
      }
      setLineItems(items.map((i) => ({ label: i.label, unitPrice: Number(i.unitPrice), qty: Number(i.qty), total: Number(i.total) })));
      toast({ title: "Priced from rate card", description: `${items.length} line item(s) added.` });
    } catch (err: any) {
      toast({ title: "Pricing failed", description: err.message, variant: "destructive" });
    } finally {
      setPricing(false);
    }
  }

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const next = { ...li, ...patch };
        next.total = Number((Number(next.unitPrice || 0) * Number(next.qty || 0)).toFixed(2));
        return next;
      })
    );
  }

  function recipientValid(): boolean {
    if (recipientMode === "client") return Boolean(clientId);
    if (recipientMode === "lead") return Boolean(leadId);
    return Boolean(newLead.name.trim() && newLead.email.trim());
  }

  function buildMeta() {
    const m = service?.model;
    const base: Record<string, unknown> = {};
    if (m === "ROOMS") {
      base.bedrooms = Number(bedrooms) || 0;
      base.bathrooms = Number(bathrooms) || 0;
      if (Number(sqm) > 0) base.sqm = Number(sqm) || 0;
    } else if (m === "AREA") {
      base.sqm = Number(sqm) || 0;
    }
    // Structured extras so they flow into the job form as Additionals on conversion.
    base.extras = selectedExtras
      .map((id) => EXTRAS_BY_ID[id])
      .filter(Boolean)
      .map((e) => ({ id: e.id, label: e.label, instructions: e.instructions }));
    return base;
  }

  function buildPayload() {
    return {
      clientId: recipientMode === "client" ? clientId : undefined,
      leadId: recipientMode === "lead" ? leadId : undefined,
      newLead: recipientMode === "new"
        ? { name: newLead.name.trim(), email: newLead.email.trim(), phone: newLead.phone.trim() || undefined, suburb: newLead.suburb.trim() || undefined }
        : undefined,
      serviceType,
      lineItems: allLines,
      subtotal,
      gstAmount,
      totalAmount,
      notes: [notes.trim(), `[[META:${JSON.stringify(buildMeta())}]]`].filter(Boolean).join("\n") || undefined,
      validUntil: validUntilDate ? new Date(`${validUntilDate}T23:59:59`).toISOString() : undefined,
    };
  }

  async function submit(send: boolean) {
    if (!recipientValid()) {
      toast({ title: "Choose a recipient", description: "Select a client/lead or enter new lead details.", variant: "destructive" });
      return;
    }
    if (allLines.length === 0 || subtotal <= 0) {
      toast({ title: "Add pricing", description: "Calculate from the rate card, add line items, or pick extras.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const quote = await res.json();
      if (!res.ok) throw new Error(quote.error ?? "Failed to create quote.");

      if (send) {
        const sendRes = await fetch(`/api/admin/quotes/${quote.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const sendBody = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok) toast({ title: "Quote created, but send failed", description: sendBody.error ?? "Open the quote to resend.", variant: "destructive" });
        else toast({ title: "Quote sent", description: "Emailed to the recipient." });
      } else {
        toast({ title: "Quote created", description: "Saved as a draft." });
      }
      router.push("/admin/quotes");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Could not create quote", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">New Quote</h2>
          <p className="text-sm text-muted-foreground">Quote an existing client or a new lead, priced per service from your rate card.</p>
        </div>
        <Button asChild variant="outline"><Link href="/admin/quotes">Back to quotes</Link></Button>
      </div>

      {/* Recipient */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recipient</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {([["client", "Existing client"], ["lead", "Existing lead"], ["new", "New lead"]] as const).map(([m, label]) => (
              <Button key={m} type="button" size="sm" variant={recipientMode === m ? "default" : "outline"} onClick={() => setRecipientMode(m)}>{label}</Button>
            ))}
          </div>
          {recipientMode === "client" ? (
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : recipientMode === "lead" ? (
            <div className="space-y-1.5">
              <Label>Lead</Label>
              <Select value={leadId} onValueChange={applyLead}>
                <SelectTrigger><SelectValue placeholder="Select a lead" /></SelectTrigger>
                <SelectContent>{leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} — {l.email}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Name</Label><Input value={newLead.name} onChange={(e) => setNewLead({ ...newLead, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={newLead.email} onChange={(e) => setNewLead({ ...newLead, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Suburb</Label><Input value={newLead.suburb} onChange={(e) => setNewLead({ ...newLead, suburb: e.target.value })} /></div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service + auto pricing */}
      <Card>
        <CardHeader><CardTitle className="text-base">Service &amp; pricing</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select value={serviceType} onValueChange={(v) => setServiceType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{services.map((s) => <SelectItem key={s.jobType} value={s.jobType}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Per-model fields */}
            {service?.model === "ROOMS" ? (
              <>
                <div className="space-y-1.5"><Label>Bedrooms</Label><Input type="number" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Bathrooms</Label><Input type="number" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Floor area (sqm)</Label><Input type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} /></div>
              </>
            ) : null}
            {service?.model === "AREA" ? (
              <div className="space-y-1.5"><Label>Area ({service.unitLabel ?? "sqm"})</Label><Input type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} /></div>
            ) : null}
            {service?.model === "WINDOWS" ? (
              <div className="space-y-1.5"><Label>Number of windows</Label><Input type="number" min="0" value={windows} onChange={(e) => setWindows(e.target.value)} /></div>
            ) : null}
            {service?.model === "ITEMS" ? (
              <div className="space-y-1.5"><Label>Number of {service.itemLabel ?? "item"}s</Label><Input type="number" min="0" value={items} onChange={(e) => setItems(e.target.value)} /></div>
            ) : null}
            {service?.model === "HOURLY" ? (
              <div className="space-y-1.5"><Label>Hours</Label><Input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            ) : null}
            {service?.model === "BANDS" ? (
              <div className="space-y-1.5">
                <Label>Size</Label>
                <Select value={bandIndex} onValueChange={setBandIndex}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(service.bands ?? []).map((b, i) => <SelectItem key={i} value={String(i)}>{b.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <Button type="button" onClick={autoPrice} disabled={pricing}>
            {pricing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Calculate from rate card
          </Button>
        </CardContent>
      </Card>

      {/* Extras / add-ons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extras / add-ons</CardTitle>
          <p className="text-xs text-muted-foreground">
            Added to the price and carried into the job form as &quot;Additionals&quot; so cleaners see exactly what extra work was quoted.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EXTRAS_CATALOG.map((e) => {
              const checked = selectedExtras.includes(e.id);
              return (
                <label key={e.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSelectedExtras((prev) => (v === true ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                      }
                    />
                    {e.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">${e.price}</span>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Line items</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setLineItems((p) => [...p, { label: "", unitPrice: 0, qty: 1, total: 0 }])}>
            <Plus className="mr-1 h-4 w-4" /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No line items yet — calculate from the rate card or add lines manually.</p>
          ) : (
            lineItems.map((li, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center gap-2">
                <Input className="col-span-6" value={li.label} placeholder="Description" onChange={(e) => updateItem(idx, { label: e.target.value })} />
                <Input className="col-span-2" type="number" step="0.01" value={li.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })} />
                <Input className="col-span-1" type="number" value={li.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })} />
                <div className="col-span-2 text-right text-sm tabular-nums">${Number(li.total).toFixed(2)}</div>
                <Button type="button" size="icon" variant="ghost" className="col-span-1 h-8 w-8" onClick={() => setLineItems((p) => p.filter((_, i) => i !== idx))}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
          <div className="grid gap-4 pt-2 md:grid-cols-3">
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Subtotal</p><p className="text-lg font-semibold tabular-nums">${subtotal.toFixed(2)}</p></div>
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{gstLabel}</p><p className="text-lg font-semibold tabular-nums">${gstAmount.toFixed(2)}</p></div>
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-semibold tabular-nums">${totalAmount.toFixed(2)}</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Notes + validity + actions */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Valid until (optional)</Label><Input type="date" value={validUntilDate} onChange={(e) => setValidUntilDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Notes (optional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, inclusions, exclusions…" /></div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => submit(false)} disabled={saving}>{saving ? "Saving…" : "Create draft"}</Button>
            <Button onClick={() => submit(true)} disabled={saving}>
              <Send className="mr-2 h-4 w-4" />
              {saving ? "Working…" : "Create & send"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
