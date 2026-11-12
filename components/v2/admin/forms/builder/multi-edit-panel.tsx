"use client";

/**
 * "Editing N questions together". Only settings valid for every selected
 * question are offered; one whose values differ shows "Mixed" and is written
 * only when changed here. Reset puts the selected questions back as they were
 * when this selection was made.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { multiEditKeysFor, sharedValue, type MultiEditKey, type MultiEditPatch } from "@/lib/forms/multi-edit";
import type { FormCondition, FormField } from "@/lib/forms/types";
import type { ConditionSourceField } from "./condition-editor";
import { CadenceControl } from "./cadence-control";
import { RuleEditor } from "./rule-editor";
import { EVIDENCE_CATEGORIES } from "./properties-panel";

function MixedCheckbox({ label, mixed, checked, onChange }: { label: string; mixed: boolean; checked: boolean; onChange: (value: boolean) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
      <span>
        {label}
        {mixed ? <span className="ml-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">(mixed)</span> : null}
      </span>
      <input ref={ref} type="checkbox" className="size-[15px] accent-[hsl(var(--e-primary))]" checked={!mixed && checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function mixedText(fields: readonly FormField[], read: (field: FormField) => unknown): string {
  const values = Array.from(new Set(fields.map((field) => {
    const value = read(field);
    return value === undefined || value === null || value === "" ? "–" : String(value);
  })));
  return `Mixed: ${values.slice(0, 3).join(", ")}${values.length > 3 ? "…" : ""}`;
}

function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function MultiEditPanel({
  fields,
  conditionFields,
  onApply,
  onReset,
}: {
  fields: FormField[];
  conditionFields: ConditionSourceField[];
  onApply: (patch: MultiEditPatch) => void;
  onReset: () => void;
}) {
  const keys = new Set<MultiEditKey>(multiEditKeysFor(fields));
  const shared = <K extends MultiEditKey>(key: K) => sharedValue(fields, key);
  const [replaceRule, setReplaceRule] = React.useState(false);
  const required = shared("required");
  const rule = shared("conditional");
  const cadence = shared("frequency");
  const scoring = shared("scoring");
  const example = shared("showExampleOnTick");

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5">
      <div className="flex items-center justify-between">
        <h2 className="e-eyebrow">Editing {fields.length} questions together</h2>
        <EButton variant="ghost" size="sm" onClick={onReset}>
          Reset
        </EButton>
      </div>
      {keys.has("required") ? (
        <MixedCheckbox label="Required" mixed={required.mixed} checked={!required.mixed && required.value === true} onChange={(value) => onApply({ required: value })} />
      ) : null}
      {keys.has("minPhotos") || keys.has("maxFiles") ? (
        <div className="grid grid-cols-2 gap-2">
          {keys.has("minPhotos") ? (
            <EField label="Minimum photos">
              <EInput
                type="number"
                min={0}
                placeholder={shared("minPhotos").mixed ? mixedText(fields, (f) => f.minPhotos) : undefined}
                value={(() => { const v = shared("minPhotos"); return v.mixed ? "" : v.value ?? ""; })()}
                onChange={(event) => onApply({ minPhotos: numberOrUndefined(event.target.value) })}
              />
            </EField>
          ) : null}
          {keys.has("maxFiles") ? (
            <EField label="Maximum">
              <EInput
                type="number"
                min={1}
                placeholder={shared("maxFiles").mixed ? mixedText(fields, (f) => f.maxFiles) : "No limit"}
                value={(() => { const v = shared("maxFiles"); return v.mixed ? "" : v.value ?? ""; })()}
                onChange={(event) => onApply({ maxFiles: numberOrUndefined(event.target.value) })}
              />
            </EField>
          ) : null}
        </div>
      ) : null}
      {keys.has("frequency") ? <CadenceControl value={cadence.mixed ? null : cadence.value} onChange={(value) => onApply({ frequency: value })} /> : null}
      {keys.has("conditional") ? (
        rule.mixed && !replaceRule ? (
          <EField label="Show only if">
            <ESelect
              value="__mixed"
              onChange={(event) => {
                if (event.target.value === "always") onApply({ conditional: undefined });
                if (event.target.value === "replace") setReplaceRule(true);
              }}
            >
              <option value="__mixed">Mixed: keep each as is</option>
              <option value="always">Always show (remove every rule)</option>
              <option value="replace">Give them all one rule…</option>
            </ESelect>
          </EField>
        ) : (
          <RuleEditor
            condition={rule.mixed ? undefined : (rule.value as FormCondition | undefined)}
            onChange={(next) => onApply({ conditional: next })}
            availableFields={conditionFields.filter((source) => !fields.some((field) => field.id === source.id))}
          />
        )
      ) : null}
      {keys.has("locationTag") ? (
        <EField label="Report area">
          <EInput
            placeholder={shared("locationTag").mixed ? mixedText(fields, (f) => f.locationTag) : "e.g. Kitchen"}
            value={(() => { const v = shared("locationTag"); return v.mixed ? "" : v.value ?? ""; })()}
            onChange={(event) => onApply({ locationTag: event.target.value || undefined })}
          />
        </EField>
      ) : null}
      {keys.has("severity") ? (
        <EField label="Priority">
          <ESelect
            value={(() => { const v = shared("severity"); return v.mixed ? "__mixed" : v.value ?? "none"; })()}
            onChange={(event) => event.target.value !== "__mixed" && onApply({ severity: event.target.value === "none" ? undefined : (event.target.value as FormField["severity"]) })}
          >
            {shared("severity").mixed ? <option value="__mixed">{mixedText(fields, (f) => f.severity)}</option> : null}
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </ESelect>
        </EField>
      ) : null}
      {keys.has("evidenceCategory") ? (
        <EField label="Evidence category">
          <ESelect
            value={(() => { const v = shared("evidenceCategory"); return v.mixed ? "__mixed" : v.value ?? ""; })()}
            onChange={(event) => event.target.value !== "__mixed" && onApply({ evidenceCategory: event.target.value || undefined })}
          >
            {shared("evidenceCategory").mixed ? <option value="__mixed">{mixedText(fields, (f) => f.evidenceCategory)}</option> : null}
            <option value="">None</option>
            {EVIDENCE_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </ESelect>
        </EField>
      ) : null}
      {keys.has("stampTag") ? (
        <EField label="Evidence stamp tag">
          <ESelect
            value={(() => { const v = shared("stampTag"); return v.mixed ? "__mixed" : v.value ?? "auto"; })()}
            onChange={(event) => event.target.value !== "__mixed" && onApply({ stampTag: event.target.value === "auto" ? undefined : event.target.value })}
          >
            {shared("stampTag").mixed ? <option value="__mixed">{mixedText(fields, (f) => f.stampTag)}</option> : null}
            <option value="auto">Auto (from wording)</option>
            <option value="before">Before</option>
            <option value="after">After</option>
            <option value="damage">Damage</option>
          </ESelect>
        </EField>
      ) : null}
      {keys.has("scoring") ? (
        <MixedCheckbox label="Counts toward QA score" mixed={scoring.mixed} checked={!scoring.mixed && scoring.value === true} onChange={(value) => onApply({ scoring: value })} />
      ) : null}
      {keys.has("showExampleOnTick") ? (
        <MixedCheckbox label="Show example photo to cleaner" mixed={example.mixed} checked={!example.mixed && example.value === true} onChange={(value) => onApply({ showExampleOnTick: value })} />
      ) : null}
      {keys.size === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">These questions have no setting in common.</p> : null}
    </div>
  );
}
