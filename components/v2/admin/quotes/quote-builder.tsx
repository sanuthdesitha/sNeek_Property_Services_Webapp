"use client";

/**
 * ESTATE quote builder — v2-native replacement for the v1 NewQuoteForm.
 * Same endpoints and payloads:
 *   POST /api/admin/quotes/price            (auto price from rate card)
 *   POST /api/admin/quotes                  (create draft)
 *   POST /api/admin/quotes/[id]/send        (create & send)
 * Built entirely on the v2 primitives + estate-kit; no components/ui/* imports.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobType } from "@prisma/client";
import { Eye, Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { calculateGstBreakdown, getGstDisplayLabel } from "@/lib/pricing/gst";
import { EXTRAS_CATALOG, EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESelect, EModal } from "@/components/v2/admin/estate-kit";

type LineItem = { label: string; unitPrice: number; qty: number; total: number };
interface Option {
  id: string;
  name: string;
  email: string;
}
interface ServiceOption {
  jobType: string;
  label: string;
  model: "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";
  itemLabel: string | null;
  unitLabel: string | null;
  bands: { label: string }[];
}
interface QuoteBuilderProps {
  leads: (Option & {
    serviceType?: JobType;
    bedrooms?: number | null;
    bathrooms?: number | null;
  })[];
  clients: Option[];
  services: ServiceOption[];
  gstEnabled: boolean;
}

type RecipientMode = "client" | "lead" | "new";

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export function QuoteBuilder({ leads, clients, services, gstEnabled }: QuoteBuilderProps) {
  const router = useRouter();

  const [recipientMode, setRecipientMode] = useState<RecipientMode>("client");
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

  const service = useMemo(
    () => services.find((s) => s.jobType === serviceType) ?? services[0],
    [services, serviceType],
  );

  const extraLines = useMemo<LineItem[]>(
    () =>
      selectedExtras
        .map((id) => EXTRAS_BY_ID[id])
        .filter(Boolean)
        .map((e) => ({ label: e.label, unitPrice: e.price, qty: 1, total: e.price })),
    [selectedExtras],
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
    if (lead.serviceType && services.some((s) => s.jobType === lead.serviceType)) {
      setServiceType(lead.serviceType);
    }
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
      const priced: LineItem[] = Array.isArray(body.result?.lineItems) ? body.result.lineItems : [];
      if (priced.length === 0) {
        toast({ title: "No price returned", description: "Add line items manually.", variant: "destructive" });
        return;
      }
      setLineItems(
        priced.map((i) => ({
          label: i.label,
          unitPrice: Number(i.unitPrice),
          qty: Number(i.qty),
          total: Number(i.total),
        })),
      );
      toast({ title: "Priced from rate card", description: `${priced.length} line item(s) added.` });
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
      }),
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
      newLead:
        recipientMode === "new"
          ? {
              name: newLead.name.trim(),
              email: newLead.email.trim(),
              phone: newLead.phone.trim() || undefined,
              suburb: newLead.suburb.trim() || undefined,
            }
          : undefined,
      serviceType,
      lineItems: allLines,
      subtotal,
      gstAmount,
      totalAmount,
      notes:
        [notes.trim(), `[[META:${JSON.stringify(buildMeta())}]]`].filter(Boolean).join("\n") || undefined,
      validUntil: validUntilDate ? new Date(`${validUntilDate}T23:59:59`).toISOString() : undefined,
    };
  }

  // Draft preview — same render endpoint v1's /admin/quotes/preview download
  // uses (POST /api/admin/quotes/preview-pdf with the create payload); the
  // returned blob (PDF, or HTML fallback) is shown inline in a modal iframe.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openPreview() {
    if (allLines.length === 0 || subtotal <= 0) {
      toast({
        title: "Add pricing first",
        description: "Calculate from the rate card, add line items, or pick extras.",
        variant: "destructive",
      });
      return;
    }
    setPreviewing(true);
    try {
      // Recipient is irrelevant to the rendered preview (the endpoint renders
      // client/lead as empty), so strip it — this also allows previewing
      // before a recipient is chosen.
      const { clientId: _c, leadId: _l, newLead: _n, ...payload } = buildPayload();
      const res = await fetch("/api/admin/quotes/preview-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  function closePreview() {
    setPreviewUrl((prev) => {
      if (prev) window.URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function submit(send: boolean) {
    if (!recipientValid()) {
      toast({
        title: "Choose a recipient",
        description: "Select a client/lead or enter new lead details.",
        variant: "destructive",
      });
      return;
    }
    if (allLines.length === 0 || subtotal <= 0) {
      toast({
        title: "Add pricing",
        description: "Calculate from the rate card, add line items, or pick extras.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const quote = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(quote.error ?? "Failed to create quote.");
      if (quote.marginWarning) {
        toast({ title: "Margin warning", description: String(quote.marginWarning) });
      }

      if (send) {
        const sendRes = await fetch(`/api/admin/quotes/${quote.id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const sendBody = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok) {
          toast({
            title: "Quote created, but send failed",
            description: sendBody.error ?? "Open the quote to resend.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Quote sent", description: "Emailed to the recipient." });
        }
      } else {
        toast({ title: "Quote created", description: "Saved as a draft." });
      }
      router.push("/v2/admin/quotes");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Could not create quote", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Inline draft preview — exact render the recipient will receive */}
      <EModal open={Boolean(previewUrl)} onClose={closePreview} eyebrow="Quotes" title="Quote preview" size="full">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="Quote preview"
            className="h-[70vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
          />
        ) : null}
      </EModal>

      {/* Recipient */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Recipient</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["client", "Existing client"],
                ["lead", "Existing lead"],
                ["new", "New lead"],
              ] as const
            ).map(([m, label]) => (
              <EButton
                key={m}
                type="button"
                size="sm"
                variant={recipientMode === m ? "primary" : "outline"}
                onClick={() => setRecipientMode(m)}
              >
                {label}
              </EButton>
            ))}
          </div>
          {recipientMode === "client" ? (
            <EField label="Client">
              <ESelect value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : recipientMode === "lead" ? (
            <EField label="Lead">
              <ESelect value={leadId} onChange={(e) => applyLead(e.target.value)}>
                <option value="">Select a lead…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {l.email}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Name">
                <EInput value={newLead.name} onChange={(e) => setNewLead({ ...newLead, name: e.target.value })} />
              </EField>
              <EField label="Email">
                <EInput
                  type="email"
                  value={newLead.email}
                  onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                />
              </EField>
              <EField label="Phone">
                <EInput value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} />
              </EField>
              <EField label="Suburb">
                <EInput
                  value={newLead.suburb}
                  onChange={(e) => setNewLead({ ...newLead, suburb: e.target.value })}
                />
              </EField>
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Service + auto pricing */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Service &amp; pricing</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <EField label="Service">
              <ESelect value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                {services.map((s) => (
                  <option key={s.jobType} value={s.jobType}>
                    {s.label}
                  </option>
                ))}
              </ESelect>
            </EField>

            {service?.model === "ROOMS" ? (
              <>
                <EField label="Bedrooms">
                  <EInput type="number" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
                </EField>
                <EField label="Bathrooms">
                  <EInput type="number" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
                </EField>
                <EField label="Floor area (sqm)">
                  <EInput type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} />
                </EField>
              </>
            ) : null}
            {service?.model === "AREA" ? (
              <EField label={`Area (${service.unitLabel ?? "sqm"})`}>
                <EInput type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "WINDOWS" ? (
              <EField label="Number of windows">
                <EInput type="number" min="0" value={windows} onChange={(e) => setWindows(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "ITEMS" ? (
              <EField label={`Number of ${service.itemLabel ?? "item"}s`}>
                <EInput type="number" min="0" value={items} onChange={(e) => setItems(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "HOURLY" ? (
              <EField label="Hours">
                <EInput type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "BANDS" ? (
              <EField label="Size">
                <ESelect value={bandIndex} onChange={(e) => setBandIndex(e.target.value)}>
                  {(service.bands ?? []).map((b, i) => (
                    <option key={i} value={String(i)}>
                      {b.label}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
          </div>

          <EButton type="button" onClick={autoPrice} disabled={pricing}>
            {pricing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Calculate from rate card
          </EButton>
        </ECardBody>
      </ECard>

      {/* Extras / add-ons */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Extras / add-ons</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Added to the price and carried into the job form as &quot;Additionals&quot; so cleaners see exactly what
            extra work was quoted.
          </p>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EXTRAS_CATALOG.map((e) => {
              const checked = selectedExtras.includes(e.id);
              return (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2.5 text-[0.8125rem] transition-colors hover:border-[hsl(var(--e-border-strong))]"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                      checked={checked}
                      onChange={(ev) =>
                        setSelectedExtras((prev) =>
                          ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id),
                        )
                      }
                    />
                    {e.label}
                  </span>
                  <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">${e.price}</span>
                </label>
              );
            })}
          </div>
        </ECardBody>
      </ECard>

      {/* Line items */}
      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Line items</ECardTitle>
          <EButton
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLineItems((p) => [...p, { label: "", unitPrice: 0, qty: 1, total: 0 }])}
          >
            <Plus className="h-4 w-4" /> Add line
          </EButton>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {lineItems.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No line items yet — calculate from the rate card or add lines manually.
            </p>
          ) : (
            lineItems.map((li, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center gap-2">
                <EInput
                  className="col-span-6"
                  value={li.label}
                  placeholder="Description"
                  onChange={(e) => updateItem(idx, { label: e.target.value })}
                />
                <EInput
                  className="col-span-2"
                  type="number"
                  step="0.01"
                  value={li.unitPrice}
                  onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                />
                <EInput
                  className="col-span-1"
                  type="number"
                  value={li.qty}
                  onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })}
                />
                <div className="col-span-2 text-right text-[0.875rem] e-tnum">{money(li.total)}</div>
                <EButton
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="col-span-1 h-8 w-8"
                  onClick={() => setLineItems((p) => p.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                </EButton>
              </div>
            ))
          )}

          {extraLines.length > 0 ? (
            <div className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>Extras included</EEyebrow>
              {extraLines.map((li, i) => (
                <div key={i} className="flex items-center justify-between text-[0.8125rem]">
                  <span className="text-[hsl(var(--e-text-secondary))]">{li.label}</span>
                  <span className="e-tnum">{money(li.total)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 pt-2 md:grid-cols-3">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>Subtotal</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{money(subtotal)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>{gstLabel}</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{money(gstAmount)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
              <EEyebrow>Total</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none text-[hsl(var(--e-gold-ink))]">
                {money(totalAmount)}
              </p>
            </div>
          </div>
        </ECardBody>
      </ECard>

      {/* Notes + validity + actions */}
      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Valid until (optional)">
              <EInput type="date" value={validUntilDate} onChange={(e) => setValidUntilDate(e.target.value)} />
            </EField>
          </div>
          <EField label="Notes (optional)">
            <ETextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Scope, inclusions, exclusions…"
            />
          </EField>
          <div className="flex flex-wrap justify-end gap-2">
            <EButton variant="ghost" onClick={openPreview} disabled={saving || previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              {previewing ? "Rendering…" : "Preview"}
            </EButton>
            <EButton variant="outline" onClick={() => submit(false)} disabled={saving}>
              {saving ? "Saving…" : "Create draft"}
            </EButton>
            <EButton variant="gold" onClick={() => submit(true)} disabled={saving}>
              <Send className="h-4 w-4" />
              {saving ? "Working…" : "Create & send"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
