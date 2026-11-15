"use client";

/**
 * Parts of the everyday dialog pattern (board "Everyday dialogs and sheets",
 * 2026-11): a facts box shown before the fields, single-choice chips, and the
 * plain "what will happen" note. Used inside `EActionDialog layout="form"`.
 *
 * - `EFacts` / `EFactRow`: label on the left, value on the right; a value the
 *   caller does not know is passed as text ("Unknown"), never as 0.
 * - `EChoiceChips`: a labelled radio group drawn as chips (native radios, so
 *   arrow keys and the form semantics work). `phoneSegmented` draws it as a
 *   two-part segmented control on a phone, 44px tall.
 * - `ENote`: the grey note; `tone` tints it from the tone-band tokens.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export function EFacts({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("space-y-1 rounded-[10px] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5 text-[0.8125rem]", className)}>
      {children}
    </div>
  );
}

export function EFactRow({ label, value, strong = false }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">{label}</span>
      <span className={cn("e-tnum shrink-0 text-right", strong ? "font-[650]" : "font-[550]")}>{value}</span>
    </div>
  );
}

export type ChoiceOption<T extends string> = { value: T; label: React.ReactNode; disabled?: boolean; phoneLabel?: React.ReactNode };

export function EChoiceChips<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled = false,
  hint,
  phoneSegmented = false,
}: {
  label: React.ReactNode;
  name: string;
  value: T | null;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: React.ReactNode;
  phoneSegmented?: boolean;
}) {
  const hintId = React.useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-1.5" aria-describedby={hint ? hintId : undefined}>
      <legend className="mb-1.5 text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">{label}</legend>
      <div className={cn("flex flex-wrap gap-1.5", phoneSegmented ? "max-sm:flex-nowrap max-sm:gap-0.5 max-sm:rounded-[10px] max-sm:bg-[hsl(var(--e-muted))] max-sm:p-[3px]" : null)}>
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "relative inline-flex min-h-8 cursor-pointer items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] max-sm:min-h-11 max-sm:px-3.5",
                "focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))]",
                checked
                  ? "border-[hsl(var(--e-primary)/0.45)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-foreground))]"
                  : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))]",
                option.disabled ? "cursor-not-allowed opacity-50" : null,
                phoneSegmented
                  ? cn("max-sm:flex-1 max-sm:justify-center max-sm:rounded-[8px] max-sm:border-transparent", checked ? "max-sm:bg-[hsl(var(--e-surface))] max-sm:shadow-[var(--e-elevation-1)]" : "max-sm:bg-transparent")
                  : null,
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              {option.phoneLabel ? (
                <>
                  <span className="max-sm:hidden">{option.label}</span>
                  <span className="sm:hidden">{option.phoneLabel}</span>
                </>
              ) : option.label}
            </label>
          );
        })}
      </div>
      {hint ? <p id={hintId} className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{hint}</p> : null}
    </fieldset>
  );
}

const NOTE_TONE = {
  plain: "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-secondary))]",
  attention: "border border-[hsl(var(--e-band-attention-line))] bg-[hsl(var(--e-band-attention-bg))] text-[hsl(var(--e-band-attention-fg))]",
  problem: "border border-[hsl(var(--e-band-problem-line))] bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]",
  good: "border border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))] text-[hsl(var(--e-band-good-fg))]",
} as const;

export function ENote({ children, tone = "plain", role, className }: { children: React.ReactNode; tone?: keyof typeof NOTE_TONE; role?: "alert" | "status"; className?: string }) {
  return (
    <div role={role} className={cn("rounded-[10px] px-3 py-2 text-[0.8125rem] [overflow-wrap:anywhere]", NOTE_TONE[tone], className)}>
      {children}
    </div>
  );
}

/**
 * Board rule: Enter does not submit while focus is in a text box. Put on a
 * dialog's <form onKeyDown>; textareas keep their new lines, buttons still
 * work with Enter.
 */
export function preventEnterSubmit(event: React.KeyboardEvent<HTMLFormElement>): void {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio" && target.type !== "submit") event.preventDefault();
}
