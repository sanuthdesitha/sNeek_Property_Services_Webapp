"use client";

/**
 * Show/hide rule for a question or section: it watches either another
 * question's answer (ConditionEditor, unchanged) or a fact about the job's
 * property ("if the property has a balcony"). Property rules use the same
 * stored shape the property checklist emits (`{ propertyField, value }`) and
 * only the keys the cleaner's form receives (lib/forms/property-conditions).
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import {
  PROPERTY_CONDITION_KEYS,
  propertyConditionKey,
  propertyConditionValue,
} from "@/lib/forms/property-conditions";
import { isPropertyFieldCondition, type FieldCondition, type FormCondition, type PropertyFieldCondition } from "@/lib/forms/types";
import { ConditionEditor, type ConditionSourceField } from "./condition-editor";

function PropertyRule({ rule, onChange }: { rule: PropertyFieldCondition; onChange: (next: FormCondition | undefined) => void }) {
  const meta = propertyConditionKey(rule.propertyField);
  const value = propertyConditionValue(rule);
  const setKey = (key: string) => {
    const nextMeta = propertyConditionKey(key);
    onChange({ propertyField: key, value: nextMeta?.kind === "number" ? 1 : true });
  };
  return (
    <div className="space-y-2.5">
      <EField label="Property fact">
        <ESelect value={rule.propertyField} onChange={(event) => setKey(event.target.value)}>
          {meta ? null : <option value={rule.propertyField}>{rule.propertyField} (not available to cleaners)</option>}
          {PROPERTY_CONDITION_KEYS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </ESelect>
      </EField>
      {meta?.kind === "number" ? (
        <EField label="Equals" hint="Shown only when the property's number is exactly this.">
          <EInput
            type="number"
            min={0}
            value={typeof value === "number" ? value : Number(value ?? 0)}
            onChange={(event) => onChange({ propertyField: rule.propertyField, value: Number(event.target.value) })}
          />
        </EField>
      ) : (
        <EField label="Is">
          <ESelect
            value={value === false || value === "false" ? "false" : "true"}
            onChange={(event) => onChange({ propertyField: rule.propertyField, value: event.target.value === "true" })}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </ESelect>
        </EField>
      )}
    </div>
  );
}

export function RuleEditor({
  condition,
  onChange,
  availableFields,
}: {
  condition: FormCondition | undefined;
  onChange: (next: FormCondition | undefined) => void;
  availableFields: ConditionSourceField[];
}) {
  const property = isPropertyFieldCondition(condition);
  const kind = !condition ? "none" : property ? "property" : "answer";

  return (
    <div className="space-y-2.5">
      <EField label="Show this">
        <ESelect
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "none") onChange(undefined);
            else if (next === "property") onChange({ propertyField: PROPERTY_CONDITION_KEYS[0].key, value: true });
            else onChange({ fieldId: availableFields[0]?.id ?? "", operator: "equals", value: "" });
          }}
        >
          <option value="none">Always</option>
          <option value="answer" disabled={availableFields.length === 0}>
            Only when another question is answered…
          </option>
          <option value="property">Only if the property has…</option>
        </ESelect>
      </EField>
      {kind === "property" ? <PropertyRule rule={condition as PropertyFieldCondition} onChange={onChange} /> : null}
      {kind === "answer" ? (
        <ConditionEditor
          condition={condition as FieldCondition}
          onChange={(next) => onChange(next)}
          availableFields={availableFields}
        />
      ) : null}
      {kind !== "none" ? (
        <EButton type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          Always show instead
        </EButton>
      ) : null}
    </div>
  );
}
