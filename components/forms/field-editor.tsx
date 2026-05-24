"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Settings } from "lucide-react";
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

export interface FieldEditorProps {
  field: FormField;
  onUpdate: (field: FormField) => void;
  onRemove: () => void;
}

export const TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  radio: "Radio",
  photo: "Photo",
  video: "Video",
  signature: "Signature",
  rating: "Rating",
  time: "Time",
  date: "Date",
};

function hasOptions(type: string): boolean {
  return type === "select" || type === "multiselect" || type === "radio";
}

export function FieldEditor({ field, onUpdate, onRemove }: FieldEditorProps) {
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Field settings"
          >
            <Settings className="size-4" />
          </Button>
        </DrawerTrigger>
        <DrawerContent side="right">
          <DrawerHeader>
            <DrawerTitle>Field settings</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor={`field-label-${field.id}`}>Label</Label>
              <Input
                id={`field-label-${field.id}`}
                value={field.label}
                onChange={(e) =>
                  onUpdate({ ...field, label: e.target.value })
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`field-help-${field.id}`}>Help text</Label>
              <Textarea
                id={`field-help-${field.id}`}
                value={field.helpText ?? ""}
                onChange={(e) =>
                  onUpdate({ ...field, helpText: e.target.value || undefined })
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`field-type-${field.id}`}>Type</Label>
              <Select
                value={field.type}
                onValueChange={(v) =>
                  onUpdate({ ...field, type: v as FormFieldType })
                }
              >
                <SelectTrigger id={`field-type-${field.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TYPE_LABELS) as Array<
                    [FormFieldType, string]
                  >).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor={`field-required-${field.id}`}>Required</Label>
              <Switch
                id={`field-required-${field.id}`}
                checked={Boolean(field.required)}
                onCheckedChange={(checked) =>
                  onUpdate({ ...field, required: checked })
                }
              />
            </div>

            {hasOptions(field.type) && (
              <div className="space-y-1">
                <Label htmlFor={`field-options-${field.id}`}>
                  Options (one per line)
                </Label>
                <Textarea
                  id={`field-options-${field.id}`}
                  value={(field.options ?? []).join("\n")}
                  onChange={(e) =>
                    onUpdate({
                      ...field,
                      options: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            )}

            {field.type === "photo" && (
              <div className="space-y-1">
                <Label htmlFor={`field-min-photos-${field.id}`}>
                  Min photos
                </Label>
                <Input
                  id={`field-min-photos-${field.id}`}
                  type="number"
                  min={0}
                  value={field.minPhotos ?? 0}
                  onChange={(e) =>
                    onUpdate({
                      ...field,
                      minPhotos: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                />
              </div>
            )}

            <p className="pt-2 text-xs text-muted-foreground">
              Conditional logic and scoring weights are coming in a Phase 3
              follow-up.
            </p>
          </div>
        </DrawerContent>
      </Drawer>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Remove field"
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
