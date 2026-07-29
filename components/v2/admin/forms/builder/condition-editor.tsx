"use client";

/**
 * ESTATE form builder — conditional visibility editor. Emits the SAME
 * FieldCondition shape v1 stores ({ fieldId, operator, value }), so templates
 * round-trip identically.
 *
 * The editor is source-aware: the operator list and the value control follow
 * the TYPE of the field the rule watches. That matters because the value has to
 * match how the answer is actually stored — a yes/no answer is a boolean, a
 * multi-select answer is an array — and a free-text box let admins author rules
 * (e.g. value "Yes") that could never fire.
 */
import * as React from "react";
import { EButton, EBadge } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { FieldCondition, FieldConditionOperator } from "@/lib/forms/types";

export type ConditionSourceField = {
  id: string;
  label: string;
  type?: string;
  options?: string[];
};

type OperatorDef = { value: FieldConditionOperator; label: string; needsValue: boolean };

const ALWAYS: OperatorDef[] = [
  { value: "answered", label: "is answered", needsValue: false },
  { value: "notAnswered", label: "is not answered", needsValue: false },
];

const EQUALITY: OperatorDef[] = [
  { value: "equals", label: "equals", needsValue: true },
  { value: "notEquals", label: "does not equal", needsValue: true },
];

const MULTI: OperatorDef[] = [
  { value: "contains", label: "includes", needsValue: true },
  { value: "notContains", label: "does not include", needsValue: true },
  { value: "oneOf", label: "is one of (comma-sep)", needsValue: true },
];

const NUMERIC: OperatorDef[] = [
  { value: "gt", label: "is greater than", needsValue: true },
  { value: "lt", label: "is less than", needsValue: true },
];

const NUMERIC_TYPES = new Set(["number", "currency", "temperature", "rating", "slider", "scale", "counter"]);
const CHOICE_TYPES = new Set(["select", "radio"]);
const MULTI_TYPES = new Set(["multiselect"]);
const BOOL_TYPES = new Set(["yesno", "checkbox"]);

function operatorsFor(type?: string): OperatorDef[] {
  if (MULTI_TYPES.has(type ?? "")) return [...EQUALITY, ...MULTI, ...ALWAYS];
  if (NUMERIC_TYPES.has(type ?? "")) return [...EQUALITY, ...NUMERIC, ...ALWAYS];
  if (BOOL_TYPES.has(type ?? "")) return [...EQUALITY, ...ALWAYS];
  if (CHOICE_TYPES.has(type ?? "")) return [...EQUALITY, { value: "oneOf", label: "is one of (comma-sep)", needsValue: true }, ...ALWAYS];
  // text-ish and everything else
  return [...EQUALITY, ...MULTI.slice(0, 2), ...ALWAYS];
}

function currentOperator(condition: FieldCondition | undefined): FieldConditionOperator {
  if (!condition) return "equals";
  return (condition.operator as FieldConditionOperator) ?? "equals";
}

function rawValue(condition: FieldCondition | undefined): unknown {
  if (!condition) return "";
  return "value" in condition ? condition.value : condition.equals;
}

function valueText(condition: FieldCondition | undefined): string {
  const raw = rawValue(condition);
  if (Array.isArray(raw)) return raw.join(", ");
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

/**
 * Coerce the typed/selected value into the shape the answer is stored in, so
 * the visibility engine compares like with like:
 *   yes/no + checkbox → boolean, numeric types → number, oneOf → array.
 */
export function coerceConditionValue(
  op: FieldConditionOperator,
  text: string,
  sourceType?: string
): unknown {
  if (op === "answered" || op === "notAnswered") return undefined;
  if (op === "oneOf") return text.split(",").map((s) => s.trim()).filter(Boolean);
  if (text === "true") return true;
  if (text === "false") return false;
  if (BOOL_TYPES.has(sourceType ?? "")) {
    if (text.toLowerCase() === "yes") return true;
    if (text.toLowerCase() === "no") return false;
    return text;
  }
  if (NUMERIC_TYPES.has(sourceType ?? "") && text.trim() !== "" && Number.isFinite(Number(text))) {
    return Number(text);
  }
  return text;
}

export function ConditionEditor({
  condition,
  onChange,
  availableFields,
}: {
  condition: FieldCondition | undefined;
  onChange: (next: FieldCondition | undefined) => void;
  availableFields: ConditionSourceField[];
}) {
  const source = availableFields.find((f) => f.id === condition?.fieldId);
  const operators = operatorsFor(source?.type);
  const operator = currentOperator(condition);
  const opDef = operators.find((o) => o.value === operator) ?? operators[0];
  const text = valueText(condition);

  const emit = (next: { fieldId?: string; operator?: FieldConditionOperator; text?: string; type?: string }) => {
    const fieldId = next.fieldId ?? condition?.fieldId ?? "";
    const op = next.operator ?? operator;
    const sourceType = next.type ?? source?.type;
    const value = coerceConditionValue(op, next.text ?? text, sourceType);
    onChange(value === undefined ? { fieldId, operator: op } : { fieldId, operator: op, value });
  };

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

  // Value control: options for choice fields, Yes/No for yes-no + checkbox,
  // a number box for numeric sources, plain text otherwise. Rendered by CALLING
  // this (not as <ValueControl/>) so the input keeps focus between keystrokes.
  function renderValueControl() {
    if (!opDef.needsValue) return null;
    const type = source?.type ?? "";
    const hint =
      operator === "oneOf"
        ? "Comma-separated list — the rule fires when any of them is selected."
        : MULTI_TYPES.has(type)
          ? "Matches when this option is among the selections."
          : undefined;

    if (BOOL_TYPES.has(type) && operator !== "oneOf") {
      return (
        <EField label="Value">
          <ESelect value={rawValue(condition) === false ? "false" : rawValue(condition) === true ? "true" : ""} onChange={(e) => emit({ text: e.target.value })}>
            <option value="" disabled>
              Choose
            </option>
            <option value="true">Yes / ticked</option>
            <option value="false">No / unticked</option>
            {type === "yesno" ? <option value="na">N/A</option> : null}
          </ESelect>
        </EField>
      );
    }

    if ((CHOICE_TYPES.has(type) || MULTI_TYPES.has(type)) && (source?.options?.length ?? 0) > 0 && operator !== "oneOf") {
      return (
        <EField label="Value" hint={hint}>
          <ESelect value={text} onChange={(e) => emit({ text: e.target.value })}>
            <option value="" disabled>
              Choose an option
            </option>
            {(source?.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </ESelect>
        </EField>
      );
    }

    return (
      <EField label="Value" hint={hint}>
        <EInput
          type={NUMERIC_TYPES.has(type) && operator !== "oneOf" ? "number" : "text"}
          value={text}
          onChange={(e) => emit({ text: e.target.value })}
          placeholder="Value"
        />
      </EField>
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
          onChange={(e) => {
            const nextSource = availableFields.find((f) => f.id === e.target.value);
            const nextOps = operatorsFor(nextSource?.type);
            const keep = nextOps.some((o) => o.value === operator) ? operator : "equals";
            emit({ fieldId: e.target.value, operator: keep, type: nextSource?.type, text: "" });
          }}
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
        <ESelect value={opDef.value} onChange={(e) => emit({ operator: e.target.value as FieldConditionOperator })}>
          {operators.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </ESelect>
      </EField>
      {renderValueControl()}
      {!source && condition.fieldId ? (
        <p className="text-[0.6875rem] text-[hsl(var(--e-warning))]">
          This rule points at a field that no longer exists — it will never show.
        </p>
      ) : null}
      <EButton type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
        Remove rule
      </EButton>
    </div>
  );
}
