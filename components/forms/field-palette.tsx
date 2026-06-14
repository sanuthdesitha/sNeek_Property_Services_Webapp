"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { Heading, Minus } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { FormFieldType } from "@/lib/forms/types";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
} from "@/lib/forms/field-types";
import { FieldIcon } from "./field-icon";

export const PALETTE_DRAG_PREFIX = "palette:";

export interface FieldPaletteProps {
  /** Click-to-add — inserts at the end of the active (or first) section. */
  onAdd: (type: FormFieldType) => void;
  /** Click-to-add a heading/info block. */
  onAddBlock: (kind: "heading" | "divider") => void;
}

/**
 * Left rail of the builder. Each field type is BOTH draggable (drop onto the
 * canvas at a precise spot) and clickable (quick-add to the active section).
 * Search narrows the list. Heading/divider blocks live in their own group.
 */
export function FieldPalette({ onAdd, onAddBlock }: FieldPaletteProps) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add fields
        </p>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search field types…"
          className="h-9"
          aria-label="Search field types"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {FIELD_CATEGORY_ORDER.map((category) => {
          const items = Object.values(FIELD_TYPES).filter(
            (d) => d.category === category && (!q || d.label.toLowerCase().includes(q)),
          );
          if (items.length === 0) return null;
          return (
            <div key={category} className="space-y-1.5">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {FIELD_CATEGORY_LABELS[category]}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {items.map((d) => (
                  <PaletteChip key={d.type} type={d.type} label={d.label} icon={d.icon} onAdd={onAdd} />
                ))}
              </div>
            </div>
          );
        })}

        {!q && (
          <div className="space-y-1.5">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Layout
            </p>
            <button
              type="button"
              onClick={() => onAddBlock("heading")}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary-soft"
            >
              <Heading className="size-4 text-muted-foreground" />
              Heading / text block
            </button>
            <button
              type="button"
              onClick={() => onAddBlock("divider")}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary-soft"
            >
              <Minus className="size-4 text-muted-foreground" />
              Divider line
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PaletteChip({
  type,
  label,
  icon,
  onAdd,
}: {
  type: FormFieldType;
  label: string;
  icon: string;
  onAdd: (type: FormFieldType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_DRAG_PREFIX}${type}`,
    data: { paletteType: type },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onAdd(type)}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary-soft ${
        isDragging ? "opacity-40" : ""
      }`}
      title={`Add ${label} — drag onto the form or click`}
    >
      <FieldIcon name={icon} className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}
