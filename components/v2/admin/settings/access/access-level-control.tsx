"use client";

import { cn } from "@/lib/utils";
import { ACCESS_LEVEL_LABELS, ACCESS_LEVEL_ORDER, type AccessLevel } from "@/lib/rbac/ops-catalog";

/**
 * Off / View / Manage / Full as one radio group. Full is gold (it adds the
 * area's sensitive actions); a level that differs from the saved one gets a
 * gold ring until it is saved.
 */
export function AccessLevelControl({
  value,
  saved,
  label,
  disabled,
  onChange,
}: {
  value: AccessLevel;
  saved: AccessLevel;
  label: string;
  disabled?: boolean;
  onChange: (level: AccessLevel) => void;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={`${label} level`}
      className="inline-flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))]"
    >
      {ACCESS_LEVEL_ORDER.map((level) => {
        const on = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(level)}
            className={cn(
              "min-h-8 border-l border-[hsl(var(--e-border))] px-2.5 text-[0.75rem] first:border-l-0 disabled:opacity-60",
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[hsl(var(--e-ring))]",
              on && level === "off" && "bg-[hsl(var(--e-surface-sunken))] font-[600] text-[hsl(var(--e-text-secondary))]",
              on && (level === "read" || level === "manage") && "bg-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary-foreground))]",
              on && level === "full" && "bg-[hsl(var(--e-gold))] font-[600] text-[hsl(var(--e-gold-foreground))]",
              !on && "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]",
              on && value !== saved && "shadow-[inset_0_0_0_2px_hsl(var(--e-gold))]",
            )}
          >
            {ACCESS_LEVEL_LABELS[level]}
          </button>
        );
      })}
    </span>
  );
}
