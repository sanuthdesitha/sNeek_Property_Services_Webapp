"use client";

/**
 * ESTATE form builder — conditional visibility editor. Emits the SAME
 * FieldCondition shape v1 stores ({ fieldId, operator, value }), so templates
 * round-trip identically. Native Estate controls.
 */
import * as React from "react";
import { EButton, EBadge } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { FieldCondition, FieldConditionOperator } from "@/lib/forms/types";

const OPERATORS: Array<{ value: FieldConditionOperator; label: string; needsValue: boolean }> = [
  { value: "equals", label: "equals", needsValue: true },
  { value: "notEquals", label: "does not equal", needsValue: true },
  { value: "answered", label: "is answered", needsValue: false },
  { value: "notAnswered", label: "is not answered", needsValue: false },
  { value: "oneOf", label: "is one of (comma-sep)", needsValue: true },
  { value: "gt", label: "is greater than", needsValue: true },
  { value: "lt", label: "is less than", needsValue: true },
];

function currentOperator(condition: FieldCondition | undefined): FieldConditionOperator {
  if (!condition) return "equals";
  return (condition.operator as FieldConditionOperator) ?? "equals";
}

function currentValueText(condition: FieldCondition | undefined): string {
  if (!condition) return "";
  const raw = "value" in condition ? condition.value : condition.equals;
  if (Array.isArray(raw)) return raw.join(", ");
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

function coerceValue(op: FieldConditionOperator, text: string): unknown {
  if (op === "answered" || op === "notAnswered") return undefined;
  if (op === "oneOf") return text.split(",").map((s) => s.trim()).filter(Boolean);
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

export function ConditionEditor({
  condition,
  onChange,
  availableFields,
}: {
  condition: FieldCondition | undefined;
  onChange: (next: FieldCondition | undefined) => void;
  availableFields: Array<{ id: string; label: string }>;
}) {
  const operator = currentOperator(condition);
  const valueText = currentValueText(condition);
  const opDef = OPERATORS.find((o) => o.value === operator) ?? OPERATORS[0];

  if (!condition) {
    return (
      <EButton
        type="button"
        variant="outline"
        size="sm"
        disabled={availableFields.length === 0}
        onClick={() => onChange({ fieldId: availableFields[0]?.id ?? "", operator: "equals", value: "" })}
      >
        + Add show / hide rule
      </EButton>
    );
  }

  return (
    <div className="space-y-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
      <EBadge tone="info" soft>
        Only show when…
      </EBadge>
      <EField label="Field">
        <ESelect
          value={condition.fieldId ?? ""}
          onChange={(e) => onChange({ fieldId: e.target.value, operator, value: coerceValue(operator, valueText) })}
        >
          <option value="" disabled>
            Choose a field
          </option>
          {availableFields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label || f.id}
            </option>
          ))}
        </ESelect>
      </EField>
      <EField label="Condition">
        <ESelect
          value={operator}
          onChange={(e) =>
            onChange({
              fieldId: condition.fieldId ?? "",
              operator: e.target.value as FieldConditionOperator,
              value: coerceValue(e.target.value as FieldConditionOperator, valueText),
            })
          }
        >
          {OPERATORS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </ESelect>
      </EField>
      {opDef.needsValue && (
        <EField label="Value" hint="Use true / false for Yes-No fields.">
          <EInput
            value={valueText}
            onChange={(e) =>
              onChange({ fieldId: condition.fieldId ?? "", operator, value: coerceValue(operator, e.target.value) })
            }
            placeholder="Value"
          />
        </EField>
      )}
      <EButton type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
        Remove rule
      </EButton>
    </div>
  );
}
