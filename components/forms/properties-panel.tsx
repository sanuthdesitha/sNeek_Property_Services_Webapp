"use client";

import * as React from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { FormField, FormFieldType } from "@/lib/forms/types";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
  getFieldTypeDef,
} from "@/lib/forms/field-types";
import { ReferenceMediaEditor } from "./reference-media-editor";
import { ConditionEditor } from "./condition-editor";
import { FieldIcon } from "./field-icon";

export interface PropertiesPanelProps {
  field: FormField;
  onUpdate: (field: FormField) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  availableFields?: Array<{ id: string; label: string }>;
}

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Grouped properties editor for the currently-selected field. Renders inline in
 * the right rail of the builder (not a drawer) so every change is immediately
 * visible in the live canvas. Reuses ReferenceMediaEditor + ConditionEditor and
 * the field-type registry — same config surface as the legacy FieldEditor
 * drawer, just laid out as a modern grouped panel.
 */
export function PropertiesPanel({
  field,
  onUpdate,
  onRemove,
  onDuplicate,
  availableFields = [],
}: PropertiesPanelProps) {
  const def = getFieldTypeDef(field.type);
  const hasOptions = Boolean(def?.hasOptions);
  const hasRange = Boolean(def?.hasRange);
  const isUpload = Boolean(def?.isUpload);
  const isReadOnly = Boolean(def?.isReadOnly);
  const scorable = Boolean(def?.scorable);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <FieldIcon name={def?.icon} className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{field.label || "Untitled field"}</p>
            <p className="text-[11px] text-muted-foreground">{def?.label ?? field.type}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate field">
              <Copy className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Delete field">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Accordion type="multiple" defaultValue={["basics"]} className="space-y-2">
          {/* ---- Basics ---- */}
          <AccordionItem value="basics" className="rounded-lg border px-3">
            <AccordionTrigger className="py-2.5 text-sm font-medium">Basics</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              <div className="space-y-1">
                <Label htmlFor={`pp-label-${field.id}`}>Label</Label>
                <Input
                  id={`pp-label-${field.id}`}
                  value={field.label}
                  onChange={(e) => onUpdate({ ...field, label: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`pp-type-${field.id}`}>Type</Label>
                <Select
                  value={field.type}
                  onValueChange={(v) =>
                    onUpdate({ ...field, type: v as FormFieldType, ...(getFieldTypeDef(v)?.defaultConfig ?? {}) })
                  }
                >
                  <SelectTrigger id={`pp-type-${field.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[50vh]">
                    {FIELD_CATEGORY_ORDER.map((category) => (
                      <React.Fragment key={category}>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                          {FIELD_CATEGORY_LABELS[category]}
                        </div>
                        {Object.values(FIELD_TYPES)
                          .filter((d) => d.category === category)
                          .map((d) => (
                            <SelectItem key={d.type} value={d.type}>
                              <span className="flex items-center gap-2">
                                <FieldIcon name={d.icon} className="size-3.5" />
                                {d.label}
                              </span>
                            </SelectItem>
                          ))}
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`pp-help-${field.id}`}>Help text / description</Label>
                <Textarea
                  id={`pp-help-${field.id}`}
                  value={field.helpText ?? ""}
                  onChange={(e) => onUpdate({ ...field, helpText: e.target.value || undefined })}
                  placeholder="Shown under the field"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`pp-instructions-${field.id}`}>How-to instructions (reveal popup)</Label>
                <Textarea
                  id={`pp-instructions-${field.id}`}
                  value={field.instructions ?? ""}
                  onChange={(e) => onUpdate({ ...field, instructions: e.target.value || undefined })}
                  placeholder="Step-by-step how to clean this — shown behind a 'How to clean this' button with any reference images/video"
                  rows={3}
                />
              </div>

              {!isReadOnly && !isUpload && (
                <div className="space-y-1">
                  <Label htmlFor={`pp-placeholder-${field.id}`}>Placeholder</Label>
                  <Input
                    id={`pp-placeholder-${field.id}`}
                    value={field.placeholder ?? ""}
                    onChange={(e) => onUpdate({ ...field, placeholder: e.target.value || undefined })}
                    placeholder="Hint shown inside the input"
                  />
                </div>
              )}

              {!isReadOnly && (
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <Label htmlFor={`pp-required-${field.id}`}>Required</Label>
                  <Switch
                    id={`pp-required-${field.id}`}
                    checked={Boolean(field.required)}
                    onCheckedChange={(checked) => onUpdate({ ...field, required: checked })}
                  />
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ---- Options ---- */}
          {hasOptions && (
            <AccordionItem value="options" className="rounded-lg border px-3">
              <AccordionTrigger className="py-2.5 text-sm font-medium">Choices</AccordionTrigger>
              <AccordionContent className="space-y-3 pb-3">
                <div className="space-y-1">
                  <Label htmlFor={`pp-options-${field.id}`}>Options (one per line)</Label>
                  <Textarea
                    id={`pp-options-${field.id}`}
                    rows={4}
                    value={(field.options ?? []).join("\n")}
                    onChange={(e) =>
                      onUpdate({
                        ...field,
                        options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`pp-allow-other-${field.id}`}>Allow &quot;Other&quot; (free text)</Label>
                  <Switch
                    id={`pp-allow-other-${field.id}`}
                    checked={Boolean(field.allowOther)}
                    onCheckedChange={(checked) => onUpdate({ ...field, allowOther: checked || undefined })}
                  />
                </div>
                {field.type === "select" && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`pp-searchable-${field.id}`}>Searchable</Label>
                    <Switch
                      id={`pp-searchable-${field.id}`}
                      checked={Boolean(field.searchable)}
                      onCheckedChange={(checked) => onUpdate({ ...field, searchable: checked || undefined })}
                    />
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ---- Yes/No ---- */}
          {field.type === "yesno" && (
            <AccordionItem value="yesno" className="rounded-lg border px-3">
              <AccordionTrigger className="py-2.5 text-sm font-medium">Yes / No behaviour</AccordionTrigger>
              <AccordionContent className="space-y-3 pb-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`pp-na-${field.id}`}>Include &quot;N/A&quot; option</Label>
                  <Switch
                    id={`pp-na-${field.id}`}
                    checked={Boolean(field.includeNa)}
                    onCheckedChange={(checked) => onUpdate({ ...field, includeNa: checked || undefined })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`pp-details-no-${field.id}`}>Require details when &quot;No&quot;</Label>
                  <Switch
                    id={`pp-details-no-${field.id}`}
                    checked={Boolean(field.detailsWhenNo)}
                    onCheckedChange={(checked) => onUpdate({ ...field, detailsWhenNo: checked || undefined })}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ---- Range ---- */}
          {hasRange && (
            <AccordionItem value="range" className="rounded-lg border px-3">
              <AccordionTrigger className="py-2.5 text-sm font-medium">Range &amp; units</AccordionTrigger>
              <AccordionContent className="grid grid-cols-3 gap-2 pb-3">
                <div className="space-y-1">
                  <Label>Min</Label>
                  <Input type="number" value={field.min ?? ""} onChange={(e) => onUpdate({ ...field, min: num(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Max</Label>
                  <Input type="number" value={field.max ?? ""} onChange={(e) => onUpdate({ ...field, max: num(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Step</Label>
                  <Input type="number" value={field.step ?? ""} onChange={(e) => onUpdate({ ...field, step: num(e.target.value) })} />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label>Unit label (optional)</Label>
                  <Input
                    value={field.unit ?? ""}
                    onChange={(e) => onUpdate({ ...field, unit: e.target.value || undefined })}
                    placeholder="e.g. min, kg, rooms"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ---- Media ---- */}
          {isUpload && (
            <AccordionItem value="media" className="rounded-lg border px-3">
              <AccordionTrigger className="py-2.5 text-sm font-medium">Capture settings</AccordionTrigger>
              <AccordionContent className="space-y-3 pb-3">
                {(field.type === "photo" || field.type === "video") && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`pp-capture-type-${field.id}`}>Capture type</Label>
                    <p className="text-[11px] text-muted-foreground">What the cleaner can capture for this field.</p>
                    <Select
                      value={field.mediaMode === "both" ? "both" : field.type === "video" ? "video" : "photo"}
                      onValueChange={(v) => {
                        if (v === "both") {
                          onUpdate({ ...field, type: "photo", mediaMode: "both", maxDurationSec: field.maxDurationSec ?? 60 });
                        } else if (v === "video") {
                          onUpdate({ ...field, type: "video", mediaMode: undefined, maxDurationSec: field.maxDurationSec ?? 60 });
                        } else {
                          onUpdate({ ...field, type: "photo", mediaMode: undefined });
                        }
                      }}
                    >
                      <SelectTrigger id={`pp-capture-type-${field.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="photo">Photo</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                        <SelectItem value="both">Photo or Video</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor={`pp-stamp-tag-${field.id}`}>Evidence stamp tag</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Burned into the top-left chip of every photo for this field. &ldquo;Auto&rdquo;
                    guesses from the section wording.
                  </p>
                  <Select
                    value={field.stampTag && field.stampTag.trim() ? field.stampTag : "auto"}
                    onValueChange={(v) =>
                      onUpdate({ ...field, stampTag: v === "auto" ? undefined : v })
                    }
                  >
                    <SelectTrigger id={`pp-stamp-tag-${field.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (from wording)</SelectItem>
                      <SelectItem value="before">Before</SelectItem>
                      <SelectItem value="after">After</SelectItem>
                      <SelectItem value="damage">Damage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {field.type !== "video" && (
                    <div className="space-y-1">
                      <Label htmlFor={`pp-min-photos-${field.id}`}>Min files</Label>
                      <Input
                        id={`pp-min-photos-${field.id}`}
                        type="number"
                        min={0}
                        value={field.minPhotos ?? 0}
                        onChange={(e) => onUpdate({ ...field, minPhotos: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor={`pp-max-files-${field.id}`}>Max files</Label>
                    <Input
                      id={`pp-max-files-${field.id}`}
                      type="number"
                      min={0}
                      value={field.maxFiles ?? ""}
                      onChange={(e) => onUpdate({ ...field, maxFiles: num(e.target.value) })}
                    />
                  </div>
                  {(field.type === "video" || field.mediaMode === "both") && (
                    <div className="space-y-1">
                      <Label htmlFor={`pp-max-duration-${field.id}`}>Max duration (sec)</Label>
                      <Input
                        id={`pp-max-duration-${field.id}`}
                        type="number"
                        min={1}
                        placeholder="60"
                        value={field.maxDurationSec ?? ""}
                        onChange={(e) => onUpdate({ ...field, maxDurationSec: num(e.target.value) })}
                      />
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ---- Context (location/severity) ---- */}
          <AccordionItem value="context" className="rounded-lg border px-3">
            <AccordionTrigger className="py-2.5 text-sm font-medium">Tagging &amp; priority</AccordionTrigger>
            <AccordionContent className="grid grid-cols-2 gap-2 pb-3">
              <div className="space-y-1">
                <Label htmlFor={`pp-location-tag-${field.id}`}>Location tag</Label>
                <Input
                  id={`pp-location-tag-${field.id}`}
                  value={field.locationTag ?? ""}
                  onChange={(e) => onUpdate({ ...field, locationTag: e.target.value || undefined })}
                  placeholder="e.g. Kitchen"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`pp-severity-${field.id}`}>Priority</Label>
                <Select
                  value={field.severity ?? "none"}
                  onValueChange={(v) =>
                    onUpdate({ ...field, severity: v === "none" ? undefined : (v as FormField["severity"]) })
                  }
                >
                  <SelectTrigger id={`pp-severity-${field.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ---- Scoring ---- */}
          {scorable && (
            <AccordionItem value="scoring" className="rounded-lg border px-3">
              <AccordionTrigger className="py-2.5 text-sm font-medium">QA scoring</AccordionTrigger>
              <AccordionContent className="grid grid-cols-2 gap-2 pb-3">
                <div className="space-y-1">
                  <Label>Score weight</Label>
                  <Input
                    type="number"
                    min={0}
                    value={field.scoring?.weight ?? ""}
                    onChange={(e) => {
                      const weight = num(e.target.value);
                      onUpdate({ ...field, scoring: weight === undefined ? undefined : { weight, max: field.scoring?.max ?? 1 } });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Score max</Label>
                  <Input
                    type="number"
                    min={1}
                    value={field.scoring?.max ?? ""}
                    onChange={(e) => {
                      const max = num(e.target.value);
                      onUpdate({ ...field, scoring: field.scoring ? { ...field.scoring, max: max ?? 1 } : undefined });
                    }}
                    disabled={!field.scoring}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ---- Reference media ---- */}
          <AccordionItem value="references" className="rounded-lg border px-3">
            <AccordionTrigger className="py-2.5 text-sm font-medium">Example media</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              <ReferenceMediaEditor
                references={field.references ?? []}
                onChange={(references) => onUpdate({ ...field, references: references.length ? references : undefined })}
              />
              {field.references && field.references.length > 0 && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <Label htmlFor={`pp-show-on-tick-${field.id}`}>Show example when ticked</Label>
                    <p className="text-[11px] text-muted-foreground">Pops the example image when the cleaner answers this item.</p>
                  </div>
                  <Switch
                    id={`pp-show-on-tick-${field.id}`}
                    checked={field.showExampleOnTick !== false}
                    onCheckedChange={(checked) => onUpdate({ ...field, showExampleOnTick: checked ? undefined : false })}
                  />
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ---- Conditional logic ---- */}
          <AccordionItem value="logic" className="rounded-lg border px-3">
            <AccordionTrigger className="py-2.5 text-sm font-medium">Conditional logic</AccordionTrigger>
            <AccordionContent className="pb-3">
              <ConditionEditor
                condition={field.conditional}
                onChange={(conditional) => onUpdate({ ...field, conditional })}
                availableFields={availableFields}
              />
            </AccordionContent>
          </AccordionItem>

          {/* ---- Sub-fields ---- */}
          {!isReadOnly && (
            <AccordionItem value="subfields" className="rounded-lg border px-3">
              <AccordionTrigger className="py-2.5 text-sm font-medium">
                Sub-fields{field.children?.length ? ` (${field.children.length})` : ""}
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <SubFieldsEditor field={field} onUpdate={onUpdate} availableFields={availableFields} />
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>
    </div>
  );
}

/** One-level-deep sub-fields editor (lifted from the legacy FieldEditor). */
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
          <div key={child.id} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                value={child.label}
                onChange={(e) => updateChild(index, { ...child, label: e.target.value })}
                placeholder="Sub-field label"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setChildren(children.filter((_, i) => i !== index))}
                aria-label="Remove sub-field"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={child.type}
                onValueChange={(v) =>
                  updateChild(index, { ...child, type: v as FormFieldType, ...(getFieldTypeDef(v)?.defaultConfig ?? {}) })
                }
              >
                <SelectTrigger aria-label="Sub-field type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[40vh]">
                  {Object.values(FIELD_TYPES).map((d) => (
                    <SelectItem key={d.type} value={d.type}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-end gap-2">
                <Label htmlFor={`pp-subfield-required-${child.id}`} className="text-xs">
                  Required
                </Label>
                <Switch
                  id={`pp-subfield-required-${child.id}`}
                  checked={Boolean(child.required)}
                  onCheckedChange={(checked) => updateChild(index, { ...child, required: checked || undefined })}
                />
              </div>
            </div>
            {childDef?.hasOptions ? (
              <Textarea
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          setChildren([
            ...children,
            { id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "text", label: "New sub-field" },
          ])
        }
      >
        <Plus className="mr-1 size-4" /> Add sub-field
      </Button>
    </div>
  );
}
