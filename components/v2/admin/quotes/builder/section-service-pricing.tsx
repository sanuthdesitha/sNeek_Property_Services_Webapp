"use client";

/**
 * 2 · Service and pricing: service and its size fields, frequency, Calculate
 * from rate card, the pricing badge (rate card / edited / manual / not
 * recorded), the margin check, the lines table (with extras and custom
 * extras), pricing variables, and what is included / not included.
 */
import { Loader2, Sparkles } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { PricingVariable } from "@/lib/pricing/variables";
import { FREQUENCY_OPTIONS, PRICING_SOURCE_BADGE } from "./model";
import type { MarginCheck } from "./margin";
import { SectionCard, LazyDisclosure } from "./section-card";
import { LinesTable } from "./lines-table";
import { PricingVariablesPanel } from "./pricing-variables";
import { IncludedSummary } from "./included-summary";
import type { QuoteBuilderState } from "./use-quote-builder";

export function SectionServicePricing({ builder, pricingVariables, margin }: { builder: QuoteBuilderState; pricingVariables: PricingVariable[]; margin: MarginCheck }) {
  const p = builder.pricing;
  const badge = PRICING_SOURCE_BADGE[p.pricingSource];
  const model = p.service?.model;
  return (
    <SectionCard eyebrow="2 · Service and pricing" aside={<EPill tone={badge.tone}>{badge.label}</EPill>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <EField label="Service" className="col-span-2 md:col-span-1 lg:col-span-2">
          <ESelect value={p.serviceType} onChange={(e) => p.setServiceType(e.target.value)}>
            {builder.serviceOptions.map((s) => (
              <option key={s.jobType} value={s.jobType}>{s.label}</option>
            ))}
          </ESelect>
        </EField>
        {model === "ROOMS" ? (
          <>
            <EField label="Bedrooms"><EInput type="number" min="0" inputMode="numeric" value={p.bedrooms} onChange={(e) => p.setBedrooms(e.target.value)} /></EField>
            <EField label="Bathrooms"><EInput type="number" min="0" inputMode="numeric" value={p.bathrooms} onChange={(e) => p.setBathrooms(e.target.value)} /></EField>
            <EField label="Floor area (sqm)"><EInput type="number" min="0" value={p.sqm} onChange={(e) => p.setSqm(e.target.value)} /></EField>
          </>
        ) : null}
        {model === "AREA" ? <EField label={`Area (${p.service?.unitLabel ?? "sqm"})`}><EInput type="number" min="0" value={p.sqm} onChange={(e) => p.setSqm(e.target.value)} /></EField> : null}
        {model === "WINDOWS" ? <EField label="Windows"><EInput type="number" min="0" value={p.windows} onChange={(e) => p.setWindows(e.target.value)} /></EField> : null}
        {model === "ITEMS" ? <EField label={`Number of ${p.service?.itemLabel ?? "item"}s`}><EInput type="number" min="0" value={p.items} onChange={(e) => p.setItems(e.target.value)} /></EField> : null}
        {model === "HOURLY" ? <EField label="Hours"><EInput type="number" min="0" step="0.5" value={p.hours} onChange={(e) => p.setHours(e.target.value)} /></EField> : null}
        {model === "BANDS" ? (
          <EField label="Size">
            <ESelect value={p.bandIndex} onChange={(e) => p.setBandIndex(e.target.value)}>
              {(p.service?.bands ?? []).map((band, i) => <option key={i} value={String(i)}>{band.label}</option>)}
            </ESelect>
          </EField>
        ) : null}
        <EField label="Frequency">
          <ESelect value={builder.frequency} onChange={(e) => builder.setFrequency(e.target.value)}>
            {FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </ESelect>
        </EField>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <EButton type="button" variant="outline" size="sm" onClick={() => void p.autoPrice()} disabled={p.pricing}>
          {p.pricing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Calculate from rate card
        </EButton>
        <EPill tone={margin.state === "below" ? "bad" : margin.state === "ok" ? "ok" : "neutral"}>{margin.label}</EPill>
      </div>

      <LinesTable builder={builder} />

      {pricingVariables.length > 0 ? (
        <LazyDisclosure title={`Pricing variables (${pricingVariables.length})`} description="Condition, location, parking and access. Changes re-price live after Calculate; nothing is saved until you save.">
          <PricingVariablesPanel builder={builder} pricingVariables={pricingVariables} />
        </LazyDisclosure>
      ) : null}

      <IncludedSummary builder={builder} />
    </SectionCard>
  );
}
