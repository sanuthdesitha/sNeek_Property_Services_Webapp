"use client";

/**
 * "When submitted" — question effects in the properties panel:
 *  - Stock count: "Raises an urgent stock need below N";
 *  - Yes / No: "'Yes' (or 'No') opens a damage report", with the area and
 *    category the phone prefills.
 * Each says exactly what will happen (lib/forms/form-effects.ts,
 * effectExplanation), so the admin is never promised more than the system does.
 */
import * as React from "react";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { damageEffectOf, effectExplanation, fieldEffects, urgentStockEffectOf } from "@/lib/forms/form-effects";
import type { DamageReportEffect, FieldEffect, FormField, UrgentStockEffect } from "@/lib/forms/types";
import { PanelSection as Section } from "./panel-section";

function replaceEffect(field: FormField, kind: FieldEffect["kind"], next: FieldEffect | null): FormField {
  const others = fieldEffects(field).filter((effect) => effect.kind !== kind);
  const effects = next ? [...others, next] : others;
  const updated = { ...field };
  if (effects.length > 0) updated.effects = effects;
  else delete updated.effects;
  return updated;
}

function Explanation({ effect }: { effect: FieldEffect }) {
  return <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] p-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{effectExplanation(effect)}</p>;
}

export function EffectSettings({ field, onUpdate }: { field: FormField; onUpdate: (field: FormField) => void }) {
  if (field.type === "stock_count") {
    const effect = urgentStockEffectOf(field);
    const set = (next: UrgentStockEffect | null) => onUpdate(replaceEffect(field, "urgent-stock-below", next));
    return (
      <Section title="When submitted" defaultOpen={Boolean(effect)}>
        <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
          Raises an urgent stock need when low
          <ESwitch checked={Boolean(effect)} onCheckedChange={(on) => set(on ? { kind: "urgent-stock-below", threshold: 3 } : null)} />
        </label>
        {effect ? (
          <>
            <EField label="Raise the need when the count is below">
              <EInput
                type="number"
                min={1}
                step={1}
                value={effect.threshold}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  set({ kind: "urgent-stock-below", threshold: Number.isInteger(value) && value >= 1 ? value : 1 });
                }}
              />
            </EField>
            <Explanation effect={effect} />
          </>
        ) : null}
      </Section>
    );
  }
  if (field.type === "yesno") {
    const effect = damageEffectOf(field);
    const set = (next: DamageReportEffect | null) => onUpdate(replaceEffect(field, "damage-report", next));
    return (
      <Section title="When submitted" defaultOpen={Boolean(effect)}>
        <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
          Opens a damage report
          <ESwitch checked={Boolean(effect)} onCheckedChange={(on) => set(on ? { kind: "damage-report", when: "yes" } : null)} />
        </label>
        {effect ? (
          <>
            <EField label="On the answer">
              <ESelect value={effect.when} onChange={(e) => set({ ...effect, when: e.target.value === "no" ? "no" : "yes" })}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </ESelect>
            </EField>
            <div className="grid grid-cols-2 gap-2">
              <EField label="Area (prefilled)" hint="Blank: the location tag or section.">
                <EInput value={effect.area ?? ""} maxLength={120} onChange={(e) => set({ ...effect, area: e.target.value || undefined })} />
              </EField>
              <EField label="Category (prefilled)">
                <EInput value={effect.category ?? ""} maxLength={120} onChange={(e) => set({ ...effect, category: e.target.value || undefined })} />
              </EField>
            </div>
            <Explanation effect={effect} />
          </>
        ) : null}
      </Section>
    );
  }
  return null;
}
