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
import { Copy, Plus, Trash2, ChevronDown } from "lucide-react";
import type { FormField, FormFieldType } from "@/lib/forms/types";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
  getFieldTypeDef,
} from "@/lib/forms/field-types";
import { cn } from "@/lib/utils";
import { EField, EInput, ETextarea, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { EFieldIcon } from "./field-icon";
import { ReferenceMediaEditor } from "./reference-media-editor";
import { ConditionEditor } from "./condition-editor";

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/* ── Self-contained Estate accordion section ───────────────────────────── */
function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]"
      >
        {title}
        <ChevronDown className={cn("size-4 shrink-0 text-[hsl(var(--e-text-faint))] transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="space-y-3 border-t border-[hsl(var(--e-border))] px-3 py-3">{children}</div> : null}
    </div>
  );
}

export function PropertiesPanel({
  field,
  onUpdate,
  onRemove,
  onDuplicate,
  availableFields = [],
}: {
  field: FormField;
  onUpdate: (field: FormField) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  availableFields?: Array<{ id: string; label: string }>;
}) {
  const def = getFieldTypeDef(field.type);
  const hasOptions = Boolean(def?.hasOptions);
  const hasRange = Boolean(def?.hasRange);
  const isUpload = Boolean(def?.isUpload);
  const isReadOnly = Boolean(def?.isReadOnly);
  const scorable = Boolean(def?.scorable);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
            <EFieldIcon name={def?.icon} className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
              {field.label || "Untitled field"}
            </p>
            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{def?.label ?? field.type}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              aria-label="Duplicate field"
              className="rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
            >
              <Copy className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            aria-label="Delete field"
            className="rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))]"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
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
        </Section>

        {/* Choices */}
        {hasOptions && (
          <Section title="Choices">
            <EField label="Options (one per line)">
              <ETextarea
                rows={4}
                value={(field.options ?? []).join("\n")}
                onChange={(e) =>
                  onUpdate({
                    ...field,
                    options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </EField>
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Allow &ldquo;Other&rdquo; (free text)</span>
              <ESwitch checked={Boolean(field.allowOther)} onCheckedChange={(v) => onUpdate({ ...field, allowOther: v || undefined })} />
            </div>
            {field.type === "select" && (
              <div className="flex items-center justify-between">
                <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Searchable</span>
                <ESwitch checked={Boolean(field.searchable)} onCheckedChange={(v) => onUpdate({ ...field, searchable: v || undefined })} />
              </div>
            )}
          </Section>
        )}

        {/* Yes/No */}
        {field.type === "yesno" && (
          <Section title="Yes / No behaviour">
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Include &ldquo;N/A&rdquo; option</span>
              <ESwitch checked={Boolean(field.includeNa)} onCheckedChange={(v) => onUpdate({ ...field, includeNa: v || undefined })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Require details when &ldquo;No&rdquo;</span>
              <ESwitch checked={Boolean(field.detailsWhenNo)} onCheckedChange={(v) => onUpdate({ ...field, detailsWhenNo: v || undefined })} />
            </div>
          </Section>
        )}

        {/* Range */}
        {hasRange && (
          <Section title="Range & units">
            <div className="grid grid-cols-3 gap-2">
              <EField label="Min">
                <EInput type="number" value={field.min ?? ""} onChange={(e) => onUpdate({ ...field, min: num(e.target.value) })} />
              </EField>
              <EField label="Max">
                <EInput type="number" value={field.max ?? ""} onChange={(e) => onUpdate({ ...field, max: num(e.target.value) })} />
              </EField>
              <EField label="Step">
                <EInput type="number" value={field.step ?? ""} onChange={(e) => onUpdate({ ...field, step: num(e.target.value) })} />
              </EField>
            </div>
            <EField label="Unit label (optional)">
              <EInput
                value={field.unit ?? ""}
                onChange={(e) => onUpdate({ ...field, unit: e.target.value || undefined })}
                placeholder="e.g. min, kg, rooms"
              />
            </EField>
          </Section>
        )}

        {/* Capture settings */}
        {isUpload && (
          <Section title="Capture settings">
            {(field.type === "photo" || field.type === "video") && (
              <EField label="Capture type" hint="What the cleaner can capture for this field.">
                <ESelect
                  value={field.mediaMode === "both" ? "both" : field.type === "video" ? "video" : "photo"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "both") onUpdate({ ...field, type: "photo", mediaMode: "both", maxDurationSec: field.maxDurationSec ?? 60 });
                    else if (v === "video") onUpdate({ ...field, type: "video", mediaMode: undefined, maxDurationSec: field.maxDurationSec ?? 60 });
                    else onUpdate({ ...field, type: "photo", mediaMode: undefined });
                  }}
                >
                  <option value="photo">Photo</option>
                  <option value="video">Video</option>
                  <option value="both">Photo or Video</option>
                </ESelect>
              </EField>
            )}

            <EField label="Evidence stamp tag" hint="Burned into the top-left chip of every photo. Auto guesses from wording.">
              <ESelect
                value={field.stampTag && field.stampTag.trim() ? field.stampTag : "auto"}
                onChange={(e) => onUpdate({ ...field, stampTag: e.target.value === "auto" ? undefined : e.target.value })}
              >
                <option value="auto">Auto (from wording)</option>
                <option value="before">Before</option>
                <option value="after">After</option>
                <option value="damage">Damage</option>
              </ESelect>
            </EField>

            <div className="grid grid-cols-2 gap-2">
              {field.type !== "video" && (
                <EField label="Min files">
                  <EInput
                    type="number"
                    min={0}
                    value={field.minPhotos ?? 0}
                    onChange={(e) => onUpdate({ ...field, minPhotos: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  />
                </EField>
              )}
              <EField label="Max files">
                <EInput type="number" min={0} value={field.maxFiles ?? ""} onChange={(e) => onUpdate({ ...field, maxFiles: num(e.target.value) })} />
              </EField>
              {(field.type === "video" || field.mediaMode === "both") && (
                <EField label="Max duration (sec)">
                  <EInput
                    type="number"
                    min={1}
                    placeholder="60"
                    value={field.maxDurationSec ?? ""}
                    onChange={(e) => onUpdate({ ...field, maxDurationSec: num(e.target.value) })}
                  />
                </EField>
              )}
            </div>
          </Section>
        )}

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
        </Section>

        {/* Conditional logic */}
        <Section title="Conditional logic">
          <ConditionEditor
            condition={field.conditional}
            onChange={(conditional) => onUpdate({ ...field, conditional })}
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

/* ── One-level-deep sub-fields editor ──────────────────────────────────── */
function SubFieldsEditor({
  field,
  onUpdate,
  availableFields,
}: {
  field: FormField;
  onUpdate: (field: FormField) => void;
  availableFields: Array<{ id: string; label: string }>;
}) {
  const children = field.children ?? [];

  function setChildren(next: FormField[]) {
    onUpdate({ ...field, children: next.length ? next : undefined });
  }
  function updateChild(index: number, child: FormField) {
    setChildren(children.map((c, i) => (i === index ? child : c)));
  }

  const conditionFields = [{ id: field.id, label: `${field.label || field.id} (parent)` }, ...availableFields];

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
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => setChildren(children.filter((_, i) => i !== index))}
                aria-label="Remove sub-field"
                className="shrink-0 rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))]"
              >
                <Trash2 className="size-4" />
              </button>
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
            <ConditionEditor
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
