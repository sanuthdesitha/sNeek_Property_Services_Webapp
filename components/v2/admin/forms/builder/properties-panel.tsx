"use client";

/**
 * ESTATE form builder — right-rail properties editor for the selected field.
 * Same config surface as the v1 PropertiesPanel (label, key/id, type, help,
 * instructions, placeholder, required, options, yes/no behaviour, range/units,
 * capture settings incl. evidence stamp tag, tagging & priority, QA scoring,
 * example media, conditional logic, one-level sub-fields) — rebuilt in native
 * Estate styling with a self-contained accordion. No components/ui/*.
 */
import * as React from "react";
import { Copy, Trash2 } from "lucide-react";
import type { FormField, FormFieldType } from "@/lib/forms/types";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
  getFieldTypeDef,
} from "@/lib/forms/field-types";
import { EConfirmButton, EField, EInput, ETextarea, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { cadenceOf, applyPatchToField } from "@/lib/forms/multi-edit";
import { EFieldIcon } from "./field-icon";
import { ReferenceMediaEditor } from "./reference-media-editor";
import type { ConditionSourceField } from "./condition-editor";
import { RuleEditor } from "./rule-editor";
import { PanelSection as Section } from "./panel-section";
import { SubFieldsEditor } from "./sub-fields-editor";
import { CadenceControl } from "./cadence-control";
import { TypeSettings } from "./type-settings";

/** Evidence taxonomy used by QA grouping and missing-evidence scoring. */
export const EVIDENCE_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ["LIVING", "Living areas"],
  ["KITCHEN", "Kitchen"],
  ["BATHROOM", "Bathroom"],
  ["BEDROOM", "Bedroom"],
  ["OUTDOOR", "Outdoor"],
  ["FINAL", "Final walkthrough"],
  ["PROPERTY_CONFIRM", "Property confirmation"],
  ["LAUNDRY_CONFIRM", "Laundry confirmation"],
];

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function PropertiesPanel({
  field,
  onUpdate,
  onRemove,
  onDuplicate,
  availableFields = [],
  repeatNote,
}: {
  field: FormField;
  onUpdate: (field: FormField) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  availableFields?: ConditionSourceField[];
  /** e.g. "Repeats once per bedroom with its section." */
  repeatNote?: string;
}) {
  const def = getFieldTypeDef(field.type);
  const isUpload = Boolean(def?.isUpload);
  const isReadOnly = Boolean(def?.isReadOnly);
  const scorable = Boolean(def?.scorable);

  return (
    // min-h-0: the panel shrinks to the editor frame (form-builder) so the
    // body below scrolls; on a phone nothing is bounded and the page scrolls.
    <div className="flex h-full min-h-0 flex-col" data-properties-panel="">
      {/* Header. On a phone the question's name is the screen's title bar, so it is not repeated here. */}
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
            <EFieldIcon name={def?.icon} className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))] max-sm:hidden">
              {field.label || "Untitled field"}
            </p>
            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{def?.label ?? field.type}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              aria-label="Duplicate field"
              className="rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] max-sm:flex max-sm:size-11 max-sm:items-center max-sm:justify-center"
            >
              <Copy className="size-4" />
            </button>
          )}
          {/* Low tier: an unsaved form-builder draft. */}
          <EConfirmButton
            ariaLabel="Delete field"
            confirmLabel={<span className="px-0.5 text-[0.6875rem] font-[600]">Sure?</span>}
            onConfirm={onRemove}
            className="rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))] max-sm:flex max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:justify-center"
          >
            <Trash2 className="size-4" />
          </EConfirmButton>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 max-sm:overflow-visible max-sm:px-3" data-properties-panel-body="">
        {/* Basics */}
        <Section title="Basics" defaultOpen>
          <EField label="Label">
            <EInput value={field.label} onChange={(e) => onUpdate({ ...field, label: e.target.value })} />
          </EField>

          <EField label="Field key" hint="Stored on the submission and referenced by conditions. Keep it unique.">
            <EInput
              value={field.id}
              onChange={(e) => onUpdate({ ...field, id: e.target.value.trim() || field.id })}
              className="font-mono text-[0.75rem]"
            />
          </EField>

          <EField label="Type">
            <ESelect
              value={field.type}
              onChange={(e) =>
                onUpdate({ ...field, type: e.target.value as FormFieldType, ...(getFieldTypeDef(e.target.value)?.defaultConfig ?? {}) })
              }
            >
              {FIELD_CATEGORY_ORDER.map((category) => (
                <optgroup key={category} label={FIELD_CATEGORY_LABELS[category]}>
                  {Object.values(FIELD_TYPES)
                    .filter((d) => d.category === category)
                    .map((d) => (
                      <option key={d.type} value={d.type}>
                        {d.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </ESelect>
          </EField>

          <EField label="Help text / description">
            <ETextarea
              value={field.helpText ?? ""}
              onChange={(e) => onUpdate({ ...field, helpText: e.target.value || undefined })}
              placeholder="Shown under the field"
            />
          </EField>

          <EField label="How-to instructions (reveal popup)">
            <ETextarea
              value={field.instructions ?? ""}
              onChange={(e) => onUpdate({ ...field, instructions: e.target.value || undefined })}
              placeholder="Step-by-step how to clean this — shown behind a button with any reference media"
              rows={3}
            />
          </EField>

          {!isReadOnly && !isUpload && (
            <EField label="Placeholder">
              <EInput
                value={field.placeholder ?? ""}
                onChange={(e) => onUpdate({ ...field, placeholder: e.target.value || undefined })}
                placeholder="Hint shown inside the input"
              />
            </EField>
          )}

          {!isReadOnly && (
            <div className="flex items-center justify-between rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Required</span>
              <ESwitch checked={Boolean(field.required)} onCheckedChange={(v) => onUpdate({ ...field, required: v })} />
            </div>
          )}

          {!isReadOnly && (
            <CadenceControl value={cadenceOf(field)} onChange={(cadence) => onUpdate(applyPatchToField(field, { frequency: cadence }))} />
          )}
          {repeatNote ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{repeatNote}</p> : null}
        </Section>

        <TypeSettings field={field} onUpdate={onUpdate} />

        {/* Tagging & priority */}
        <Section title="Tagging & priority">
          <div className="grid grid-cols-2 gap-2">
            <EField label="Location tag">
              <EInput
                value={field.locationTag ?? ""}
                onChange={(e) => onUpdate({ ...field, locationTag: e.target.value || undefined })}
                placeholder="e.g. Kitchen"
              />
            </EField>
            <EField label="Evidence category">
              <ESelect
                value={field.evidenceCategory ?? ""}
                onChange={(e) => onUpdate({ ...field, evidenceCategory: e.target.value || undefined })}
              >
                <option value="">None</option>
                {field.evidenceCategory && !EVIDENCE_CATEGORIES.some(([value]) => value === field.evidenceCategory) ? (
                  <option value={field.evidenceCategory}>{field.evidenceCategory}</option>
                ) : null}
                {EVIDENCE_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Priority">
              <ESelect
                value={field.severity ?? "none"}
                onChange={(e) =>
                  onUpdate({ ...field, severity: e.target.value === "none" ? undefined : (e.target.value as FormField["severity"]) })
                }
              >
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </ESelect>
            </EField>
          </div>
        </Section>

        {/* Device status: an explicit truthful status / exception control */}
        {!isReadOnly && !isUpload && (
          <Section title="Device status">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                Ask for the device&apos;s actual status (working / exception with a reason)
              </span>
              <ESwitch
                checked={field.deviceStatus === true}
                onCheckedChange={(v) => onUpdate({ ...field, deviceStatus: v ? true : undefined })}
              />
            </div>
          </Section>
        )}

        {/* QA scoring */}
        {scorable && (
          <Section title="QA scoring">
            <div className="grid grid-cols-2 gap-2">
              <EField label="Score weight">
                <EInput
                  type="number"
                  min={0}
                  value={field.scoring?.weight ?? ""}
                  onChange={(e) => {
                    const weight = num(e.target.value);
                    onUpdate({ ...field, scoring: weight === undefined ? undefined : { weight, max: field.scoring?.max ?? 1 } });
                  }}
                />
              </EField>
              <EField label="Score max">
                <EInput
                  type="number"
                  min={1}
                  value={field.scoring?.max ?? ""}
                  onChange={(e) => {
                    const max = num(e.target.value);
                    onUpdate({ ...field, scoring: field.scoring ? { ...field.scoring, max: max ?? 1 } : undefined });
                  }}
                  disabled={!field.scoring}
                />
              </EField>
            </div>
          </Section>
        )}

        {/* Example media */}
        <Section title="Example media">
          <ReferenceMediaEditor
            references={field.references ?? []}
            onChange={(references) => onUpdate({ ...field, references: references.length ? references : undefined })}
          />
          {field.references && field.references.length > 0 && (
            <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <div>
                <p className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Show example when ticked</p>
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Pops the example when the cleaner answers this item.</p>
              </div>
              <ESwitch
                checked={field.showExampleOnTick !== false}
                onCheckedChange={(v) => onUpdate({ ...field, showExampleOnTick: v ? undefined : false })}
              />
            </div>
          )}
          <EField label="AI photo check: acceptance criteria (optional)" hint="Office only; never shown to cleaners. What a good photo of this item shows, for example 'Shower glass has no water spots; drain clear'. Used with the example photos when AI photo review is on.">
            <ETextarea
              value={field.aiCriteria ?? ""}
              onChange={(e) => onUpdate({ ...field, aiCriteria: e.target.value.slice(0, 1000) || undefined })}
              maxLength={1000}
              rows={2}
            />
          </EField>
        </Section>

        {/* Conditional logic */}
        <Section title="Show / hide rule" defaultOpen={Boolean(field.conditional)}>
          <RuleEditor
            condition={field.conditional}
            onChange={(conditional) => {
              const next = { ...field };
              if (conditional) next.conditional = conditional;
              else delete next.conditional;
              onUpdate(next);
            }}
            availableFields={availableFields}
          />
        </Section>

        {/* Sub-fields */}
        {!isReadOnly && (
          <Section title={`Sub-fields${field.children?.length ? ` (${field.children.length})` : ""}`}>
            <SubFieldsEditor field={field} onUpdate={onUpdate} availableFields={availableFields} />
          </Section>
        )}
      </div>
    </div>
  );
}
