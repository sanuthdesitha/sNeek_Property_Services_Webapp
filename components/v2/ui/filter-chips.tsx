"use client";

/**
 * ESTATE filter chips: a single-choice row of status filters with real counts.
 * Rendered as a labelled group of toggle buttons (aria-pressed), so the current
 * choice is announced and every chip is reachable with Tab.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type EFilterChip<TKey extends string> = {
  key: TKey;
  label: string;
  /** A real total from the server; omit rather than guess. */
  count?: number | null;
};

export type EFilterChipsProps<TKey extends string> = {
  label: string;
  chips: Array<EFilterChip<TKey>>;
  active: TKey;
  onChange: (key: TKey) => void;
  disabled?: boolean;
  className?: string;
};

export function EFilterChips<TKey extends string>({
  label,
  chips,
  active,
  onChange,
  disabled = false,
  className,
}: EFilterChipsProps<TKey>) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => {
        const pressed = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(chip.key)}
            className={cn(
              "inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-3 text-[0.75rem] font-[550] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50",
              pressed
                ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
            )}
          >
            {chip.label}
            {typeof chip.count === "number" ? (
              <span
                className={cn(
                  "e-tnum rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem]",
                  pressed ? "bg-[hsl(var(--e-surface))]" : "bg-[hsl(var(--e-muted))]",
                )}
              >
                {chip.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
