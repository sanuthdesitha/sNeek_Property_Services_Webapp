"use client";

/**
 * One-level-deep sub-questions of a question (moved out of the properties
 * panel unchanged, plus property rules through RuleEditor).
 */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FormField, FormFieldType } from "@/lib/forms/types";
import { FIELD_TYPES, getFieldTypeDef } from "@/lib/forms/field-types";
import { EConfirmButton, EInput, ETextarea, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import type { ConditionSourceField } from "./condition-editor";
import { RuleEditor } from "./rule-editor";

/* ── One-level-deep sub-fields editor ──────────────────────────────────── */
export function SubFieldsEditor({
  field,
  onUpdate,
  availableFields,
}: {
  field: FormField;
  onUpdate: (field: FormField) => void;
  availableFields: ConditionSourceField[];
}) {
  const children = field.children ?? [];

  function setChildren(next: FormField[]) {
    onUpdate({ ...field, children: next.length ? next : undefined });
  }
  function updateChild(index: number, child: FormField) {
    setChildren(children.map((c, i) => (i === index ? child : c)));
  }

  const conditionFields: ConditionSourceField[] = [
    { id: field.id, label: `${field.label || field.id} (parent)`, type: field.type, options: field.options },
    ...availableFields,
  ];

  return (
    <div className="space-y-2">
      {children.map((child, index) => {
        const childDef = getFieldTypeDef(child.type);
        return (
          <div key={child.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
            <div className="flex items-center gap-2">
              <EInput
                value={child.label}
                onChange={(e) => updateChild(index, { ...child, label: e.target.value })}
                placeholder="Sub-field label"
                className="min-w-0 flex-1"
              />
              {/* Low tier: one sub-field of an unsaved form draft. */}
              <EConfirmButton
                ariaLabel="Remove sub-field"
                confirmLabel="Remove?"
                onConfirm={() => setChildren(children.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4 text-[hsl(var(--e-danger))]" />
              </EConfirmButton>
            </div>
            <div className="grid grid-cols-2 items-center gap-2">
              <ESelect
                value={child.type}
                onChange={(e) =>
                  updateChild(index, { ...child, type: e.target.value as FormFieldType, ...(getFieldTypeDef(e.target.value)?.defaultConfig ?? {}) })
                }
                aria-label="Sub-field type"
              >
                {Object.values(FIELD_TYPES).map((d) => (
                  <option key={d.type} value={d.type}>
                    {d.label}
                  </option>
                ))}
              </ESelect>
              <div className="flex items-center justify-end gap-2">
                <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Required</span>
                <ESwitch
                  checked={Boolean(child.required)}
                  onCheckedChange={(v) => updateChild(index, { ...child, required: v || undefined })}
                />
              </div>
            </div>
            {childDef?.hasOptions ? (
              <ETextarea
                value={(child.options ?? []).join("\n")}
                onChange={(e) =>
                  updateChild(index, {
                    ...child,
                    options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="Options (one per line)"
              />
            ) : null}
            <RuleEditor
              condition={child.conditional}
              onChange={(conditional) => updateChild(index, { ...child, conditional })}
              availableFields={conditionFields}
            />
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          setChildren([
            ...children,
            { id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "text", label: "New sub-field" },
          ])
        }
        className="inline-flex items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-1.5 text-[0.75rem] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]"
      >
        <Plus className="size-4" /> Add sub-field
      </button>
    </div>
  );
}
