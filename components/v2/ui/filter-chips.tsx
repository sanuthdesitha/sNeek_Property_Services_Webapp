"use client";

/**
 * ESTATE filter chips: a single-choice row of status filters with real counts.
 * Rendered as a labelled group of toggle buttons (aria-pressed), so the current
 * choice is announced and every chip is reachable with Tab.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useInFilterSheet } from "./filter-sheet-context";

/** The concept's `.chip`: 28px pill on the surface, hairline border. */
export const E_CHIP_CLASS =
  "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] " +
  "bg-[hsl(var(--e-surface))] px-2.5 text-[0.75rem] font-[500] text-[hsl(var(--e-text-secondary))] transition-colors " +
  "hover:text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50 " +
  // Phones: a 44px tap target (board "Admin phone"); unchanged from 640px up.
  "max-sm:min-h-11 max-sm:px-3";
/** `.chip.on`: primary-soft fill, primary text. */
export const E_CHIP_ON_CLASS =
  "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]";

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
  /**
   * Phones only: "carousel" keeps the chips on one swipeable row (a queue or
   * stage switch above a list); the default wraps. Inside the phone filter
   * sheet the chips always wrap.
   */
  phoneLayout?: "wrap" | "carousel";
};

export function EFilterChips<TKey extends string>({
  label,
  chips,
  active,
  onChange,
  disabled = false,
  className,
  phoneLayout = "wrap",
}: EFilterChipsProps<TKey>) {
  const inSheet = useInFilterSheet();
  const carousel = phoneLayout === "carousel" && !inSheet;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        carousel && "max-sm:-mx-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-1 max-sm:pb-0.5 max-sm:[scrollbar-width:none]",
        className,
      )}
    >
      {inSheet ? <p className="basis-full text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">{label}</p> : null}
      {chips.map((chip) => {
        const pressed = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(chip.key)}
            className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS, carousel && "max-sm:shrink-0")}
          >
            {chip.label}
            {typeof chip.count === "number" ? <span className="e-tnum">{chip.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
