"use client";

/**
 * Estate-native rate-card & service pricing editor. Same endpoints v1 uses:
 *   GET  /api/admin/pricing/rate-card   → { pricing, rows, preview, seeded }
 *   POST /api/admin/pricing/rate-card   (regenerate from rack rate)
 *   PATCH /api/admin/pricing/rate-card  { id, baseRate }  (single override)
 *   PATCH /api/admin/settings           { pricing: { cleanerHourlyCost,
 *              rackHourlyRate, marginFloorPercent, gstEnabled } }
 *   GET  /api/admin/pricing/services    → { services, gstEnabled }
 *   PATCH /api/admin/pricing/services   { jobType, rate }
 *
 * Margin-floor guard (as v1): each rate-card row shows its implied gross margin;
 * rows at or below the configured floor are flagged, and a base-rate override
 * that would breach the floor asks for confirmation before saving.
 */
import * as React from "react";
import { Loader2, Save, DollarSign, RefreshCw, AlertTriangle } from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESwitch, ETableShell } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";

/* ── Rate-card types (mirror /api/admin/pricing/rate-card) ─────────────── */
type PricingSettings = {
  cleanerHourlyCost: number;
  rackHourlyRate: number;
  marginFloorPercent: number;
  gstEnabled: boolean;
};
type RateRow = {
  id: string;
  jobType: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  hours: number;
  baseRate: number;
  margin: number | null;
};

/* ── Per-service types (mirror /api/admin/pricing/services) ────────────── */
type Band = { label: string; price: number };
type Rate = {
  base?: number;
  perBedroom?: number;
  perBathroom?: number;
  perSqm?: number;
  perWindow?: number;
  perItem?: number;
  hourly?: number;
  bands?: Band[];
  minCharge: number;
};
type Service = {
  jobType: string;
  label: string;
  model: "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";
  itemLabel: string | null;
  unitLabel: string | null;
  rate: Rate;
};

const MODEL_LABEL: Record<Service["model"], string> = {
  ROOMS: "Per bedroom + bathroom",
  AREA: "Per area",
  WINDOWS: "Per window",
  ITEMS: "Per item",
  BANDS: "Size bands",
  HOURLY: "Hourly",
};

/** Gross margin (%) implied by a price — identical formula to lib/pricing/rate-card. */
function impliedMargin(price: number, hours: number, cleanerHourlyCost: number): number | null {
  if (price <= 0) return null;
  const cost = hours * cleanerHourlyCost;
  return Number((((price - cost) / price) * 100).toFixed(1));
}

/* ── Rate card panel ────────────────────────────────────────────────────── */
function RateCardPanel() {
  const [pricing, setPricing] = React.useState<PricingSettings | null>(null);
  const [rows, setRows] = React.useState<RateRow[]>([]);
  const [seeded, setSeeded] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [savingRowId, setSavingRowId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing/rate-card", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not load rate card", description: body.error ?? "Retry.", variant: "destructive" });
        return;
      }
      setPricing(body.pricing);
      setRows(body.rows ?? []);
      setSeeded(Boolean(body.seeded));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(patch: Partial<PricingSettings>) {
    if (!pricing) return;
    const next = { ...pricing, ...patch };
    setPricing(next);
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing: patch }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: b.error ?? "Could not save pricing settings.", variant: "destructive" });
        return;
      }
      toast({ title: "Pricing settings saved" });
      // Margins depend on cost/rack — reload to recompute the table.
      await load();
    } finally {
      setSavingSettings(false);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await fetch("/api/admin/pricing/rate-card", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not regenerate", description: body.error ?? "Retry.", variant: "destructive" });
        return;
      }
      toast({ title: `Rate card regenerated (${body.generated} rows)` });
      await load();
    } finally {
      setRegenerating(false);
    }
  }

  function patchRow(id: string, baseRate: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, baseRate } : r)));
  }

  async function saveRow(row: RateRow) {
    // Margin-floor guard: recompute the margin for the entered price and confirm
    // before saving anything that breaches the configured floor (as v1 clamps).
    if (pricing) {
      const margin = impliedMargin(row.baseRate, row.hours, pricing.cleanerHourlyCost);
      if (margin !== null && margin < pricing.marginFloorPercent) {
        const ok = window.confirm(
          `This price implies a ${margin}% gross margin, below the ${pricing.marginFloorPercent}% floor. Save anyway?`
        );
        if (!ok) return;
      }
    }
    setSavingRowId(row.id);
    try {
      const res = await fetch("/api/admin/pricing/rate-card", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, baseRate: row.baseRate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Save failed", description: body.error ?? "Could not update price.", variant: "destructive" });
        return;
      }
      toast({ title: `${row.label} updated` });
      await load();
    } finally {
      setSavingRowId(null);
    }
  }

  if (loading || !pricing) {
    return (
      <div className="flex items-center gap-2 p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading rate card…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ECard>
        <ECardHeader>
          <ECardTitle>Rate card basis</ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Prices are built from cleaner-hours × the rack hourly rate. The margin floor is the
            minimum gross margin any quote must keep after discounts.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Cleaner cost / hr" hint="Cost base for margin.">
              <div className="flex items-center gap-1">
                <span className="text-[hsl(var(--e-muted-foreground))]">$</span>
                <EInput
                  type="number"
                  min={0}
                  step="0.5"
                  value={pricing.cleanerHourlyCost}
                  disabled={savingSettings}
                  onChange={(e) => setPricing({ ...pricing, cleanerHourlyCost: Number(e.target.value) })}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== undefined) void saveSettings({ cleanerHourlyCost: v });
                  }}
                />
              </div>
            </EField>
            <EField label="Rack rate / hr" hint="Customer-facing effective rate.">
              <div className="flex items-center gap-1">
                <span className="text-[hsl(var(--e-muted-foreground))]">$</span>
                <EInput
                  type="number"
                  min={1}
                  step="0.5"
                  value={pricing.rackHourlyRate}
                  disabled={savingSettings}
                  onChange={(e) => setPricing({ ...pricing, rackHourlyRate: Number(e.target.value) })}
                  onBlur={(e) => void saveSettings({ rackHourlyRate: Number(e.target.value) })}
                />
              </div>
            </EField>
            <EField label="Margin floor" hint="Minimum gross margin (%).">
              <div className="flex items-center gap-1">
                <EInput
                  type="number"
                  min={0}
                  max={95}
                  step="1"
                  value={pricing.marginFloorPercent}
                  disabled={savingSettings}
                  onChange={(e) => setPricing({ ...pricing, marginFloorPercent: Number(e.target.value) })}
                  onBlur={(e) => void saveSettings({ marginFloorPercent: Number(e.target.value) })}
                />
                <span className="text-[hsl(var(--e-muted-foreground))]">%</span>
              </div>
            </EField>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-4">
            <ESwitch
              checked={pricing.gstEnabled}
              disabled={savingSettings}
              onCheckedChange={(v) => void saveSettings({ gstEnabled: v })}
              label="Add GST (10%) to quotes"
            />
            <EButton variant="outline" size="sm" onClick={() => void regenerate()} disabled={regenerating}>
              {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {regenerating ? "Regenerating…" : "Regenerate from rack rate"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader>
          <ECardTitle>Rate card</ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Base price per service and size. Override a base rate inline; rows below the margin
            floor are flagged.
          </p>
        </ECardHeader>
        <ECardBody className="pt-0">
          {!seeded || rows.length === 0 ? (
            <EAlert tone="info" title="No rate card yet">
              Regenerate from the rack rate above to seed the price book.
            </EAlert>
          ) : (
            <ETableShell
              headers={[
                { label: "Service" },
                { label: "Size" },
                { label: "Hrs", align: "right" },
                { label: "Base rate", align: "right" },
                { label: "Margin", align: "right" },
                { label: "", align: "right" },
              ]}
            >
              {rows.map((row) => {
                const margin = impliedMargin(row.baseRate, row.hours, pricing.cleanerHourlyCost);
                const belowFloor = margin !== null && margin < pricing.marginFloorPercent;
                const busy = savingRowId === row.id;
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 font-[550]">{row.label}</td>
                    <td className="px-4 py-2.5 text-[hsl(var(--e-muted-foreground))]">
                      {row.bedrooms ?? "–"}bd / {row.bathrooms ?? "–"}ba
                    </td>
                    <td className="e-tnum px-4 py-2.5 text-right text-[hsl(var(--e-muted-foreground))]">
                      {row.hours}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="ml-auto flex max-w-[7rem] items-center gap-1">
                        <span className="text-[hsl(var(--e-muted-foreground))]">$</span>
                        <EInput
                          type="number"
                          min={0}
                          step="1"
                          value={row.baseRate}
                          className="h-9 text-right"
                          onChange={(e) => patchRow(row.id, Number(e.target.value))}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {margin === null ? (
                        <span className="text-[hsl(var(--e-text-faint))]">—</span>
                      ) : (
                        <EBadge tone={belowFloor ? "danger" : "success"} soft>
                          {belowFloor ? <AlertTriangle className="h-3 w-3" /> : null}
                          {margin}%
                        </EBadge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <EButton size="sm" variant="outline" onClick={() => void saveRow(row)} disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save
                      </EButton>
                    </td>
                  </tr>
                );
              })}
            </ETableShell>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}

/* ── Per-service rate editor (mirrors v1 PricingEditor) ─────────────────── */
function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number) => void;
}) {
  return (
    <EField label={label}>
      <div className="flex items-center gap-1">
        <span className="text-[hsl(var(--e-muted-foreground))]">$</span>
        <EInput
          type="number"
          className="h-9"
          value={value ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </EField>
  );
}

function ServicePricingPanel() {
  const [services, setServices] = React.useState<Service[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingType, setSavingType] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing/services", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not load pricing", description: body.error ?? "Retry.", variant: "destructive" });
        return;
      }
      setServices(body.services ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function patchRate(jobType: string, patch: Partial<Rate>) {
    setServices((prev) => prev.map((s) => (s.jobType === jobType ? { ...s, rate: { ...s.rate, ...patch } } : s)));
  }
  function patchBand(jobType: string, idx: number, patch: Partial<Band>) {
    setServices((prev) =>
      prev.map((s) => {
        if (s.jobType !== jobType) return s;
        const bands = (s.rate.bands ?? []).map((b, i) => (i === idx ? { ...b, ...patch } : b));
        return { ...s, rate: { ...s.rate, bands } };
      })
    );
  }

  async function saveService(s: Service) {
    setSavingType(s.jobType);
    try {
      const res = await fetch("/api/admin/pricing/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: s.jobType, rate: s.rate }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed.");
      }
      toast({ title: `${s.label} saved` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingType(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading service pricing…
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {services.map((s) => (
        <ECard key={s.jobType}>
          <ECardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <ECardTitle className="text-[1rem]">{s.label}</ECardTitle>
              <EBadge tone="neutral" className="mt-1.5">
                {MODEL_LABEL[s.model]}
              </EBadge>
            </div>
            <EButton size="sm" onClick={() => void saveService(s)} disabled={savingType === s.jobType}>
              {savingType === s.jobType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingType === s.jobType ? "Saving…" : "Save"}
            </EButton>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {s.model === "ROOMS" ? (
                <>
                  <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                  <NumField label="Per bedroom" value={s.rate.perBedroom} onChange={(n) => patchRate(s.jobType, { perBedroom: n })} />
                  <NumField label="Per bathroom" value={s.rate.perBathroom} onChange={(n) => patchRate(s.jobType, { perBathroom: n })} />
                  <NumField label="Per sqm" value={s.rate.perSqm} onChange={(n) => patchRate(s.jobType, { perSqm: n })} />
                </>
              ) : null}
              {s.model === "AREA" ? (
                <>
                  <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                  <NumField label={`Per ${s.unitLabel ?? "sqm"}`} value={s.rate.perSqm} onChange={(n) => patchRate(s.jobType, { perSqm: n })} />
                </>
              ) : null}
              {s.model === "WINDOWS" ? (
                <>
                  <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                  <NumField label="Per window" value={s.rate.perWindow} onChange={(n) => patchRate(s.jobType, { perWindow: n })} />
                </>
              ) : null}
              {s.model === "ITEMS" ? (
                <>
                  <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                  <NumField label={`Per ${s.itemLabel ?? "item"}`} value={s.rate.perItem} onChange={(n) => patchRate(s.jobType, { perItem: n })} />
                </>
              ) : null}
              {s.model === "HOURLY" ? (
                <>
                  <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                  <NumField label="Per hour" value={s.rate.hourly} onChange={(n) => patchRate(s.jobType, { hourly: n })} />
                </>
              ) : null}
              <NumField label="Minimum charge" value={s.rate.minCharge} onChange={(n) => patchRate(s.jobType, { minCharge: n })} />
            </div>

            {s.model === "BANDS" ? (
              <div className="space-y-2">
                {(s.rate.bands ?? []).map((b, i) => (
                  <div key={i} className="grid grid-cols-3 items-center gap-2">
                    <EInput
                      className="col-span-2 h-9"
                      value={b.label}
                      onChange={(e) => patchBand(s.jobType, i, { label: e.target.value })}
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-[hsl(var(--e-muted-foreground))]">$</span>
                      <EInput
                        className="h-9"
                        type="number"
                        value={b.price}
                        onChange={(e) => patchBand(s.jobType, i, { price: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ))}
    </div>
  );
}

/* ── Composed editor ────────────────────────────────────────────────────── */
export function EstatePricingEditor() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
            <DollarSign className="h-4 w-4" />
          </span>
          <div>
            <EEyebrow>Basis & rate card</EEyebrow>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Rack rate, cost, and the margin-floor guard that protects every quote.
            </p>
          </div>
        </div>
        <RateCardPanel />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
            <DollarSign className="h-4 w-4" />
          </span>
          <div>
            <EEyebrow>Service pricing</EEyebrow>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Per-service rate fields. Rates are ex-GST and feed every quote.
            </p>
          </div>
        </div>
        <ServicePricingPanel />
      </section>
    </div>
  );
}
