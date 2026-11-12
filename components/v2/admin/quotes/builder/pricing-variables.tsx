"use client";

/** Settings-driven pricing variables (condition, zone, parking…), unchanged from the old builder. */
import { EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { PricingVariable } from "@/lib/pricing/variables";
import { CUSTOM_OPTION, adjustHint, isPerUnitVariable, money, perUnitPreview } from "./model";
import type { QuoteBuilderState } from "./use-quote-builder";

function NumberVariable({ builder, variable }: { builder: QuoteBuilderState; variable: PricingVariable }) {
  const p = builder.pricing;
  const perUnit = isPerUnitVariable(variable);
  const qtyRaw = p.variableNumbers[variable.id] ?? "";
  const hint = perUnit ? [variable.note, perUnitPreview(variable, qtyRaw)].filter(Boolean).join(" — ") : variable.note;
  const label = perUnit
    ? `${variable.label}${variable.unitLabel ? ` — quantity (${variable.unitLabel})` : " — quantity"}`
    : variable.unitLabel
      ? `${variable.label} (${variable.unitLabel})`
      : variable.label;
  return (
    <EField label={label} hint={hint}>
      <EInput
        type="number"
        step="any"
        min={perUnit ? "0" : undefined}
        inputMode={perUnit ? "decimal" : undefined}
        value={qtyRaw}
        placeholder={perUnit ? "How many…" : "0"}
        onChange={(e) => p.setVariableNumbers((prev) => ({ ...prev, [variable.id]: e.target.value }))}
      />
    </EField>
  );
}

function OptionVariable({ builder, variable }: { builder: QuoteBuilderState; variable: PricingVariable }) {
  const p = builder.pricing;
  const choice = p.variableChoices[variable.id] ?? "";
  return (
    <div className="space-y-2">
      <EField label={variable.label} hint={variable.note}>
        <ESelect value={choice} onChange={(e) => p.setVariableChoices((prev) => ({ ...prev, [variable.id]: e.target.value }))}>
          {(variable.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>{option.label}{adjustHint(option.adjustType, option.adjustValue)}</option>
          ))}
          {variable.allowCustom ? <option value={CUSTOM_OPTION}>Other…</option> : null}
        </ESelect>
      </EField>
      {variable.allowCustom && choice === CUSTOM_OPTION ? (
        <EInput aria-label={`${variable.label}: custom value`} value={p.variableCustom[variable.id] ?? ""} placeholder="Type the custom value…" onChange={(e) => p.setVariableCustom((prev) => ({ ...prev, [variable.id]: e.target.value }))} />
      ) : null}
    </div>
  );
}

export function PricingVariablesPanel({ builder, pricingVariables }: { builder: QuoteBuilderState; pricingVariables: PricingVariable[] }) {
  const lines = builder.pricing.variableLines;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {pricingVariables.map((variable) =>
          variable.kind === "number" ? <NumberVariable key={variable.id} builder={builder} variable={variable} /> : <OptionVariable key={variable.id} builder={builder} variable={variable} />,
        )}
      </div>
      {lines.length > 0 ? (
        <div className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
          <EEyebrow>Adjustments applied</EEyebrow>
          {lines.map((line, i) => (
            <div key={i} className="flex items-center justify-between text-[0.8125rem]">
              <span className="text-[hsl(var(--e-text-secondary))]">{line.label}</span>
              <span className="e-tnum">{money(line.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
