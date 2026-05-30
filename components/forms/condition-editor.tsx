"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { FieldCondition, FieldConditionOperator } from "@/lib/forms/types";

export interface ConditionEditorProps {
  condition: FieldCondition | undefined;
  onChange: (next: FieldCondition | undefined) => void;
  availableFields: Array<{ id: string; label: string }>;
}

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
  if (condition.operator) return condition.operator;
  return "equals";
}

function currentValueText(condition: FieldCondition | undefined): string {
  if (!condition) return "";
  const raw = "value" in condition ? condition.value : condition.equals;
  if (Array.isArray(raw)) return raw.join(", ");
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

export function ConditionEditor({ condition, onChange, availableFields }: ConditionEditorProps) {
  const operator = currentOperator(condition);
  const valueText = currentValueText(condition);
  const opDef = OPERATORS.find((o) => o.value === operator) ?? OPERATORS[0];

  function setFieldId(fieldId: string) {
    onChange({ fieldId, operator, value: coerceValue(operator, valueText) });
  }

  function setOperator(next: FieldConditionOperator) {
    onChange({
      fieldId: condition?.fieldId ?? "",
      operator: next,
      value: coerceValue(next, valueText),
    });
  }

  function setValue(text: string) {
    onChange({ fieldId: condition?.fieldId ?? "", operator, value: coerceValue(operator, text) });
  }

  function coerceValue(op: FieldConditionOperator, text: string): unknown {
    if (op === "answered" || op === "notAnswered") return undefined;
    if (op === "oneOf") {
      return text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (text === "true") return true;
    if (text === "false") return false;
    return text;
  }

  if (!condition) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={availableFields.length === 0}
        onClick={() => onChange({ fieldId: availableFields[0]?.id ?? "", operator: "equals", value: "" })}
      >
        + Add show/hide condition
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label className="text-xs text-muted-foreground">Only show this field when…</Label>
      <div className="grid gap-2">
        <Select value={condition.fieldId} onValueChange={setFieldId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a field" />
          </SelectTrigger>
          <SelectContent>
            {availableFields.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label || f.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={operator} onValueChange={(v) => setOperator(v as FieldConditionOperator)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATORS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {opDef.needsValue && (
          <Input
            value={valueText}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value (use true/false for Yes/No)"
          />
        )}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
        Remove condition
      </Button>
    </div>
  );
}
