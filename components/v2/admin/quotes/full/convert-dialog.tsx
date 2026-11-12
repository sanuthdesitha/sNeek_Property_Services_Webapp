"use client";

/**
 * Convert to job (from the old detail page, unchanged rules): link one of the
 * client's properties or create one from the service address (needs a
 * client), create the job now with a date or only mark it won.
 * `POST /api/admin/quotes/[id]/convert-to-job`. Fields freeze while it runs.
 */
import * as React from "react";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";

const RECURRING: Record<string, { label: string; blurb: string }> = {
  weekly: { label: "Weekly", blurb: "We'll create the first visit and save a weekly recurring schedule on the property." },
  fortnightly: { label: "Fortnightly", blurb: "We'll create the first visit and save a fortnightly recurring schedule on the property." },
  monthly: { label: "Monthly", blurb: "We'll create the first visit and save a monthly recurring schedule on the property." },
};

export type ConvertQuoteFacts = { id: string; clientId: string | null; serviceType: string; frequency: string | null; prefillAddress: string; prefillSuburb: string };
type PropertyRow = { id: string; name: string; suburb?: string | null };

export function ConvertDialog({ open, quote, initialDate, onClose, onDone }: { open: boolean; quote: ConvertQuoteFacts; initialDate: string; onClose: () => void; onDone: (jobId: string | null) => Promise<void> }) {
  const [properties, setProperties] = React.useState<PropertyRow[] | null>(null);
  const [mode, setMode] = React.useState<"existing" | "new">("existing");
  const [propertyId, setPropertyId] = React.useState("");
  const [address, setAddress] = React.useState(quote.prefillAddress);
  const [suburb, setSuburb] = React.useState(quote.prefillSuburb);
  const [name, setName] = React.useState("");
  const [geo, setGeo] = React.useState<{ lat: number; lng: number } | null>(null);
  const [createJob, setCreateJob] = React.useState(true);
  const [date, setDate] = React.useState(initialDate);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setDate((current) => current || initialDate);
  }, [open, initialDate]);

  React.useEffect(() => {
    if (!open || properties) return;
    const controller = new AbortController();
    const url = quote.clientId ? `/api/admin/properties?clientId=${encodeURIComponent(quote.clientId)}` : "/api/admin/properties";
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const rows: unknown = await res.json().catch(() => []);
        if (controller.signal.aborted) return;
        const list = (Array.isArray(rows) ? rows : Array.isArray((rows as { properties?: unknown })?.properties) ? (rows as { properties: unknown[] }).properties : []) as PropertyRow[];
        setProperties(list);
        if (list.length === 0) setMode("new");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setProperties([]);
        setMode("new");
      });
    return () => controller.abort();
  }, [open, properties, quote.clientId]);

  const recurring = RECURRING[quote.frequency ?? "one_off"];
  const propertyReady = mode === "existing" ? Boolean(propertyId) : Boolean(address.trim() && suburb.trim() && quote.clientId);
  const blocked = busy || !propertyReady || (createJob && !date);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { createJob };
      if (mode === "existing") payload.propertyId = propertyId;
      else payload.newProperty = { address: address.trim(), suburb: suburb.trim(), ...(name.trim() ? { name: name.trim() } : {}), ...(geo ? { latitude: geo.lat, longitude: geo.lng } : {}) };
      if (createJob) payload.scheduledDate = `${date}T00:00:00.000Z`;
      const res = await fetch(`/api/admin/quotes/${quote.id}/convert-to-job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; job?: { id?: string } | null };
      if (!res.ok) throw new Error(body.error ?? "Failed to convert quote.");
      await onDone(createJob ? body.job?.id ?? null : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open={open} onClose={() => (busy ? undefined : onClose())} eyebrow="Quotes" title="Convert to job">
      <fieldset disabled={busy} className="space-y-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {createJob
            ? `Creates a ${quote.serviceType.replace(/_/g, " ").toLowerCase()} job from this quote and marks the quote as converted.`
            : "Links (or creates) the property and marks this quote converted, with no job yet, so you can schedule the first visit later."}
        </p>
        {recurring ? (
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
            <EEyebrow>{recurring.label} service</EEyebrow>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{recurring.blurb}</p>
          </div>
        ) : (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">One-off service: a single job will be created.</p>
        )}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Property">
          <EButton type="button" size="sm" variant={mode === "existing" ? "gold" : "outline"} aria-pressed={mode === "existing"} onClick={() => setMode("existing")} disabled={!properties || properties.length === 0}>Link existing</EButton>
          <EButton type="button" size="sm" variant={mode === "new" ? "gold" : "outline"} aria-pressed={mode === "new"} onClick={() => setMode("new")}>Create from address</EButton>
        </div>
        {mode === "existing" ? (
          <EField label="Existing property">
            <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">{properties === null ? "Loading properties…" : properties.length === 0 ? "No properties for this client" : "Select property…"}</option>
              {(properties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.suburb ? ` — ${p.suburb}` : ""}</option>)}
            </ESelect>
          </EField>
        ) : (
          <div className="space-y-3">
            {!quote.prefillAddress ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No address is on file for this quote. Enter the service address to continue.</p> : null}
            <EField label="Service address">
              <EAddressInput value={address} placeholder="Start typing an address…" onChange={setAddress} onSelect={(r) => { setAddress(r.formattedAddress); if (r.suburb) setSuburb(r.suburb); setGeo(Number.isFinite(r.lat) && Number.isFinite(r.lng) ? { lat: r.lat, lng: r.lng } : null); }} />
            </EField>
            <EField label="Suburb"><EInput value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="Bondi" /></EField>
            <EField label="Property name (optional)"><EInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the address" /></EField>
            {!quote.clientId ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">Assign this quote to a client before creating a property from its address.</p> : null}
          </div>
        )}
        <ESwitch checked={createJob} onCheckedChange={setCreateJob} label="Create a job now" />
        {createJob ? <EField label="Scheduled date"><EInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></EField> : null}
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="outline" size="sm" onClick={onClose}>Cancel</EButton>
          <EButton variant="gold" size="sm" onClick={() => void submit()} disabled={blocked}>{busy ? "Converting…" : createJob ? "Create job" : "Mark won without a job"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
