"use client";

/**
 * ESTATE form builder — left-rail field palette. Lists every field type from
 * the shared registry (lib/forms/field-types), grouped by category, plus two
 * structural block shortcuts (heading / divider). Click adds to the active
 * section. Native Estate styling — no dnd-kit, no components/ui/*.
 */
import * as React from "react";
import { Heading, Minus, Plus } from "lucide-react";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
} from "@/lib/forms/field-types";
import type { FormFieldType } from "@/lib/forms/types";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { EFieldIcon } from "./field-icon";

export function FieldPalette({
  onAdd,
  onAddBlock,
}: {
  onAdd: (type: FormFieldType) => void;
  onAddBlock: (kind: "heading" | "divider") => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[hsl(var(--e-border))] px-4 py-3">
        <EEyebrow>Field palette</EEyebrow>
        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Click to add to the selected section.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {/* Structure blocks */}
        <div className="space-y-1.5">
          <p className="px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
            Structure
          </p>
          <button
            type="button"
            onClick={() => onAddBlock("heading")}
            className="flex w-full items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-left text-[0.8125rem] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:border-[hsl(var(--e-gold)/0.5)] hover:bg-[hsl(var(--e-muted))]"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))] text-[hsl(var(--e-text-secondary))]">
              <Heading className="size-3.5" />
            </span>
            Heading / note
          </button>
          <button
            type="button"
            onClick={() => onAddBlock("divider")}
            className="flex w-full items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-left text-[0.8125rem] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:border-[hsl(var(--e-gold)/0.5)] hover:bg-[hsl(var(--e-muted))]"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))] text-[hsl(var(--e-text-secondary))]">
              <Minus className="size-3.5" />
            </span>
            Divider
          </button>
        </div>

        {FIELD_CATEGORY_ORDER.map((category) => {
          const defs = Object.values(FIELD_TYPES).filter((d) => d.category === category);
          if (defs.length === 0) return null;
          return (
            <div key={category} className="space-y-1.5">
              <p className="px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
                {FIELD_CATEGORY_LABELS[category]}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {defs.map((def) => (
                  <button
                    key={def.type}
                    type="button"
                    onClick={() => onAdd(def.type)}
                    className="group flex w-full items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-left text-[0.8125rem] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:border-[hsl(var(--e-gold)/0.5)] hover:bg-[hsl(var(--e-muted))]"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
                      <EFieldIcon name={def.icon} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{def.label}</span>
                    <Plus className="size-3.5 shrink-0 text-[hsl(var(--e-text-faint))] opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
