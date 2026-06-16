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
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { calculateGstBreakdown, getGstDisplayLabel } from "@/lib/pricing/gst";

const SERVICE_TYPES: Array<{ value: JobType; label: string }> = [
  { value: JobType.AIRBNB_TURNOVER, label: "Airbnb Turnover" },
  { value: JobType.GENERAL_CLEAN, label: "General Clean" },
  { value: JobType.SPRING_CLEANING, label: "Spring Cleaning" },
  { value: JobType.DEEP_CLEAN, label: "Deep Clean" },
  { value: JobType.END_OF_LEASE, label: "End of Lease" },
  { value: JobType.CARPET_STEAM_CLEAN, label: "Carpet Steam Clean" },
  { value: JobType.WINDOW_CLEAN, label: "Window Clean" },
  { value: JobType.PRESSURE_WASH, label: "Pressure Wash" },
  { value: JobType.UPHOLSTERY_CLEANING, label: "Upholstery Cleaning" },
  { value: JobType.TILE_GROUT_CLEANING, label: "Tile & Grout Cleaning" },
  { value: JobType.POST_CONSTRUCTION, label: "Post Construction" },
  { value: JobType.COMMERCIAL_RECURRING, label: "Commercial Recurring" },
  { value: JobType.SPECIAL_CLEAN, label: "Special Clean" },
];

const ADD_ONS: Array<{ key: string; label: string }> = [
  { key: "oven", label: "Oven" },
  { key: "fridge", label: "Fridge" },
  { key: "interiorWindows", label: "Interior windows" },
  { key: "smallBalcony", label: "Balcony" },
  { key: "carpetSteam", label: "Carpet steam" },
  { key: "garage", label: "Garage" },
  { key: "insideCupboards", label: "Inside cupboards" },
  { key: "heavyMess", label: "Heavy soiling" },
  { key: "sameDay", label: "Same-day" },
  { key: "pets", label: "Pets" },
];

type LineItem = { label: string; unitPrice: number; qty: number; total: number };
interface Option { id: string; name: string; email: string; suburb?: string | null; serviceType?: JobType; bedrooms?: number | null; bathrooms?: number | null; }
interface NewQuoteFormProps {
  leads: Option[];
  clients: Option[];
  gstEnabled: boolean;
}

export function NewQuoteForm({ leads, clients, gstEnabled }: NewQuoteFormProps) {
  const router = useRouter();

  const [recipientMode, setRecipientMode] = useState<"client" | "lead" | "new">("client");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [newLead, setNewLead] = useState({ name: "", email: "", phone: "", suburb: "" });

  const [serviceType, setServiceType] = useState<JobType>(JobType.AIRBNB_TURNOVER);
  const [bedrooms, setBedrooms] = useState("2");
  const [bathrooms, setBathrooms] = useState("1");
  const [frequency, setFrequency] = useState<"one_off" | "weekly" | "fortnightly" | "monthly">("one_off");
  const [conditionLevel, setConditionLevel] = useState<"light" | "standard" | "heavy">("standard");
  const [promoCode, setPromoCode] = useState("");
  const [addOns, setAddOns] = useState<Record<string, boolean>>({});

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [pricing, setPricing] = useState(false);
  const [discountClamped, setDiscountClamped] = useState(false);
  const [notes, setNotes] = useState("");
  const [validUntilDate, setValidUntilDate] = useState("");
  const [saving, setSaving] = useState(false);

  const bedsN = Number(bedrooms) || 0;
  const bathsN = Number(bathrooms) || 0;

  const { subtotal, gstAmount, totalAmount } = useMemo(() => {
    const sum = lineItems.reduce((acc, li) => acc + (Number(li.total) || 0), 0);
    return calculateGstBreakdown(Math.max(0, Number(sum.toFixed(2))), { gstEnabled });
  }, [lineItems, gstEnabled]);
  const gstLabel = useMemo(() => getGstDisplayLabel({ gstEnabled }), [gstEnabled]);

  function applyLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    if (lead.serviceType) setServiceType(lead.serviceType);
    if (lead.bedrooms != null) setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms != null) setBathrooms(String(lead.bathrooms));
  }

  async function autoPrice() {
    setPricing(true);
    setDiscountClamped(false);
    try {
      const res = await fetch("/api/admin/quotes/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType,
          bedrooms: bedsN,
          bathrooms: bathsN,
          frequency,
          conditionLevel,
          addOns,
          promoCode: promoCode.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not price this quote.");
      if (body.requiresManualQuote) {
        toast({ title: "Manual quote needed", description: body.message ?? "Add line items by hand.", });
        return;
      }
      const result = body.result;
      const items: LineItem[] = Array.isArray(result?.lineItems) ? result.lineItems : [];
      if (items.length === 0) {
        toast({ title: "No price returned", description: "Add line items manually.", variant: "destructive" });
        return;
      }
      setLineItems(items.map((i) => ({ label: i.label, unitPrice: Number(i.unitPrice), qty: Number(i.qty), total: Number(i.total) })));
      setDiscountClamped(Boolean(result?.discountClamped));
      toast({
        title: "Priced from rate card",
        description: result?.discountClamped ? "Discount capped to keep the margin floor." : `${items.length} line item(s) added.`,
      });
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

  function buildPayload() {
    return {
      clientId: recipientMode === "client" ? clientId : undefined,
      leadId: recipientMode === "lead" ? leadId : undefined,
      newLead: recipientMode === "new"
        ? { name: newLead.name.trim(), email: newLead.email.trim(), phone: newLead.phone.trim() || undefined, suburb: newLead.suburb.trim() || undefined }
        : undefined,
      serviceType,
      lineItems,
      subtotal,
      gstAmount,
      totalAmount,
      notes: [notes.trim(), `[[META:${JSON.stringify({ bedrooms: bedsN, bathrooms: bathsN })}]]`].filter(Boolean).join("\n") || undefined,
      validUntil: validUntilDate ? new Date(`${validUntilDate}T23:59:59`).toISOString() : undefined,
    };
  }

  async function submit(send: boolean) {
    if (!recipientValid()) {
      toast({ title: "Choose a recipient", description: "Select a client/lead or enter new lead details.", variant: "destructive" });
      return;
    }
    if (lineItems.length === 0 || subtotal <= 0) {
      toast({ title: "Add pricing", description: "Calculate from the rate card or add line items.", variant: "destructive" });
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
        if (!sendRes.ok) {
          toast({ title: "Quote created, but send failed", description: sendBody.error ?? "Open the quote to resend.", variant: "destructive" });
        } else {
          toast({ title: "Quote sent", description: "The luxury quote was emailed to the recipient." });
        }
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
          <p className="text-sm text-muted-foreground">Quote an existing client or a new lead, priced from your rate card.</p>
        </div>
        <Button asChild variant="outline"><Link href="/admin/quotes">Back to quotes</Link></Button>
      </div>

      {/* Recipient */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recipient</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {([["client", "Existing client"], ["lead", "Existing lead"], ["new", "New lead"]] as const).map(([m, label]) => (
              <Button key={m} type="button" size="sm" variant={recipientMode === m ? "default" : "outline"} onClick={() => setRecipientMode(m)}>
                {label}
              </Button>
            ))}
          </div>
          {recipientMode === "client" ? (
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : recipientMode === "lead" ? (
            <div className="space-y-1.5">
              <Label>Lead</Label>
              <Select value={leadId} onValueChange={applyLead}>
                <SelectTrigger><SelectValue placeholder="Select a lead" /></SelectTrigger>
                <SelectContent>
                  {leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} — {l.email}</SelectItem>)}
                </SelectContent>
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select value={serviceType} onValueChange={(v: JobType) => setServiceType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Bedrooms</Label><Input type="number" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Bathrooms</Label><Input type="number" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v: any) => setFrequency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_off">One-off</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="fortnightly">Fortnightly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Condition</Label>
              <Select value={conditionLevel} onValueChange={(v: any) => setConditionLevel(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="heavy">Heavy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Promo code (optional)</Label><Input value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="e.g. FIRSTCLEAN" /></div>
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Add-ons</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {ADD_ONS.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={Boolean(addOns[a.key])} onCheckedChange={(v) => setAddOns((p) => ({ ...p, [a.key]: v === true }))} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>

          <Button type="button" onClick={autoPrice} disabled={pricing}>
            {pricing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Calculate from rate card
          </Button>
          {discountClamped ? <Badge variant="warning" className="ml-2">Discount capped to margin floor</Badge> : null}
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

          <div className="grid gap-4 md:grid-cols-3 pt-2">
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
