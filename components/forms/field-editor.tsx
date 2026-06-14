"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Settings, Copy, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
import { StatusPill } from "@/components/ui/status-pill";
import type { FormField, FormFieldType } from "@/lib/forms/types";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
  getFieldTypeDef,
} from "@/lib/forms/field-types";
import { ReferenceMediaEditor } from "./reference-media-editor";
import { ConditionEditor } from "./condition-editor";

export interface FieldEditorProps {
  field: FormField;
  onUpdate: (field: FormField) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  availableFields?: Array<{ id: string; label: string }>;
}

export const TYPE_LABELS: Record<FormFieldType, string> = Object.fromEntries(
  Object.values(FIELD_TYPES).map((def) => [def.type, def.label])
) as Record<FormFieldType, string>;

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function FieldEditor({ field, onUpdate, onRemove, onDuplicate, availableFields = [] }: FieldEditorProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const def = getFieldTypeDef(field.type);
  const hasOptions = Boolean(def?.hasOptions);
  const hasRange = Boolean(def?.hasRange);
  const isUpload = Boolean(def?.isUpload);
  const isReadOnly = Boolean(def?.isReadOnly);
  const scorable = Boolean(def?.scorable);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-border bg-surface px-3 py-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground"
        aria-label="Drag field"
      >
        <GripVertical className="size-4" />
      </button>
      <Input
        value={field.label}
        onChange={(e) => onUpdate({ ...field, label: e.target.value })}
        className="flex-1"
        aria-label="Field label"
      />
      <StatusPill variant="neutral">
        {TYPE_LABELS[field.type as FormFieldType] ?? field.type}
      </StatusPill>
      {field.required && <StatusPill variant="warning">Required</StatusPill>}

      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Field settings">
            <Settings className="size-4" />
          </Button>
        </DrawerTrigger>
        <DrawerContent side="right">
          <DrawerHeader>
            <DrawerTitle>Field settings</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-4 overflow-y-auto pb-10">
            <div className="space-y-1">
              <Label htmlFor={`field-label-${field.id}`}>Label</Label>
              <Input
                id={`field-label-${field.id}`}
                value={field.label}
                onChange={(e) => onUpdate({ ...field, label: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`field-help-${field.id}`}>Help text / description</Label>
              <Textarea
                id={`field-help-${field.id}`}
                value={field.helpText ?? ""}
                onChange={(e) => onUpdate({ ...field, helpText: e.target.value || undefined })}
              />
            </div>

            {!isReadOnly && !isUpload && (
              <div className="space-y-1">
                <Label htmlFor={`field-placeholder-${field.id}`}>Placeholder</Label>
                <Input
                  id={`field-placeholder-${field.id}`}
                  value={field.placeholder ?? ""}
                  onChange={(e) => onUpdate({ ...field, placeholder: e.target.value || undefined })}
                  placeholder="Hint shown inside the input"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`field-location-tag-${field.id}`}>Location tag</Label>
                <Input
                  id={`field-location-tag-${field.id}`}
                  value={field.locationTag ?? ""}
                  onChange={(e) => onUpdate({ ...field, locationTag: e.target.value || undefined })}
                  placeholder="e.g. Kitchen"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`field-severity-${field.id}`}>Priority</Label>
                <Select
                  value={field.severity ?? "none"}
                  onValueChange={(v) =>
                    onUpdate({ ...field, severity: v === "none" ? undefined : (v as FormField["severity"]) })
                  }
                >
                  <SelectTrigger id={`field-severity-${field.id}`}>
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
            </div>

            <div className="space-y-1">
              <Label htmlFor={`field-type-${field.id}`}>Type</Label>
              <Select
                value={field.type}
                onValueChange={(v) => onUpdate({ ...field, type: v as FormFieldType, ...(getFieldTypeDef(v)?.defaultConfig ?? {}) })}
              >
                <SelectTrigger id={`field-type-${field.id}`}>
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
                            {d.label}
                          </SelectItem>
                        ))}
                    </React.Fragment>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!isReadOnly && (
              <div className="flex items-center justify-between">
                <Label htmlFor={`field-required-${field.id}`}>Required</Label>
                <Switch
                  id={`field-required-${field.id}`}
                  checked={Boolean(field.required)}
                  onCheckedChange={(checked) => onUpdate({ ...field, required: checked })}
                />
              </div>
            )}

            {hasOptions && (
              <>
                <div className="space-y-1">
                  <Label htmlFor={`field-options-${field.id}`}>Options (one per line)</Label>
                  <Textarea
                    id={`field-options-${field.id}`}
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
                  <Label htmlFor={`field-allow-other-${field.id}`}>Allow &quot;Other&quot; (free text)</Label>
                  <Switch
                    id={`field-allow-other-${field.id}`}
                    checked={Boolean(field.allowOther)}
                    onCheckedChange={(checked) => onUpdate({ ...field, allowOther: checked || undefined })}
                  />
                </div>
                {field.type === "select" && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`field-searchable-${field.id}`}>Searchable</Label>
                    <Switch
                      id={`field-searchable-${field.id}`}
                      checked={Boolean(field.searchable)}
                      onCheckedChange={(checked) => onUpdate({ ...field, searchable: checked || undefined })}
                    />
                  </div>
                )}
              </>
            )}

            {field.type === "yesno" && (
              <>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`field-na-${field.id}`}>Include &quot;N/A&quot; option</Label>
                  <Switch
                    id={`field-na-${field.id}`}
                    checked={Boolean(field.includeNa)}
                    onCheckedChange={(checked) => onUpdate({ ...field, includeNa: checked || undefined })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`field-details-no-${field.id}`}>Require details when &quot;No&quot;</Label>
                  <Switch
                    id={`field-details-no-${field.id}`}
                    checked={Boolean(field.detailsWhenNo)}
                    onCheckedChange={(checked) => onUpdate({ ...field, detailsWhenNo: checked || undefined })}
                  />
                </div>
              </>
            )}

            {hasRange && (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>Min</Label>
                  <Input
                    type="number"
                    value={field.min ?? ""}
                    onChange={(e) => onUpdate({ ...field, min: num(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Max</Label>
                  <Input
                    type="number"
                    value={field.max ?? ""}
                    onChange={(e) => onUpdate({ ...field, max: num(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Step</Label>
                  <Input
                    type="number"
                    value={field.step ?? ""}
                    onChange={(e) => onUpdate({ ...field, step: num(e.target.value) })}
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label>Unit label (optional)</Label>
                  <Input
                    value={field.unit ?? ""}
                    onChange={(e) => onUpdate({ ...field, unit: e.target.value || undefined })}
                    placeholder="e.g. min, kg, rooms"
                  />
                </div>
              </div>
            )}

            {isUpload && (
              <div className="grid grid-cols-2 gap-2">
                {field.type !== "video" && (
                  <div className="space-y-1">
                    <Label htmlFor={`field-min-photos-${field.id}`}>Min files</Label>
                    <Input
                      id={`field-min-photos-${field.id}`}
                      type="number"
                      min={0}
                      value={field.minPhotos ?? 0}
                      onChange={(e) =>
                        onUpdate({ ...field, minPhotos: Math.max(0, parseInt(e.target.value, 10) || 0) })
                      }
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor={`field-max-files-${field.id}`}>Max files</Label>
                  <Input
                    id={`field-max-files-${field.id}`}
                    type="number"
                    min={0}
                    value={field.maxFiles ?? ""}
                    onChange={(e) => onUpdate({ ...field, maxFiles: num(e.target.value) })}
                  />
                </div>
                {field.type === "video" && (
                  <div className="space-y-1">
                    <Label htmlFor={`field-max-duration-${field.id}`}>Max duration (sec)</Label>
                    <Input
                      id={`field-max-duration-${field.id}`}
                      type="number"
                      min={1}
                      placeholder="60"
                      value={field.maxDurationSec ?? ""}
                      onChange={(e) => onUpdate({ ...field, maxDurationSec: num(e.target.value) })}
                    />
                  </div>
                )}
              </div>
            )}

            {scorable && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Score weight</Label>
                  <Input
                    type="number"
                    min={0}
                    value={field.scoring?.weight ?? ""}
                    onChange={(e) => {
                      const weight = num(e.target.value);
                      onUpdate({
                        ...field,
                        scoring: weight === undefined ? undefined : { weight, max: field.scoring?.max ?? 1 },
                      });
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
                      onUpdate({
                        ...field,
                        scoring: field.scoring ? { ...field.scoring, max: max ?? 1 } : undefined,
                      });
                    }}
                    disabled={!field.scoring}
                  />
                </div>
              </div>
            )}

            <ReferenceMediaEditor
              references={field.references ?? []}
              onChange={(references) =>
                onUpdate({ ...field, references: references.length ? references : undefined })
              }
            />

            {field.references && field.references.length > 0 && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor={`field-show-on-tick-${field.id}`}>Show example when ticked</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Pops the example image when the cleaner answers this item.
                  </p>
                </div>
                <Switch
                  id={`field-show-on-tick-${field.id}`}
                  checked={field.showExampleOnTick !== false}
                  onCheckedChange={(checked) =>
                    onUpdate({ ...field, showExampleOnTick: checked ? undefined : false })
                  }
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Conditional visibility</Label>
              <ConditionEditor
                condition={field.conditional}
                onChange={(conditional) => onUpdate({ ...field, conditional })}
                availableFields={availableFields}
              />
            </div>

            {!isReadOnly && (
              <SubFieldsEditor
                field={field}
                onUpdate={onUpdate}
                availableFields={availableFields}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {onDuplicate && (
        <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate field">
          <Copy className="size-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove field">
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
}

/**
 * One-level-deep sub-fields. Each child is a regular FormField rendered
 * indented under its parent on the cleaner form and counted in validation,
 * conditions, and statistics.
 */
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

  // Children may reference the parent (or any other field) in conditions.
  const conditionFields = [{ id: field.id, label: `${field.label || field.id} (parent)` }, ...availableFields];

  return (
    <div className="space-y-2">
      <Label>Sub-fields</Label>
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
                  updateChild(index, {
                    ...child,
                    type: v as FormFieldType,
                    ...(getFieldTypeDef(v)?.defaultConfig ?? {}),
                  })
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
                <Label htmlFor={`subfield-required-${child.id}`} className="text-xs">
                  Required
                </Label>
                <Switch
                  id={`subfield-required-${child.id}`}
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
            {
              id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: "text",
              label: "New sub-field",
            },
          ])
        }
      >
        <Plus className="mr-1 size-4" /> Add sub-field
      </Button>
    </div>
  );
}
