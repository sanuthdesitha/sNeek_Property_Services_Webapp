"use client";

/**
 * The finish outcome as large radio choices (board "Maintenance portal",
 * screen 3) instead of a dropdown. Same values, same single state; native
 * radios keep keyboard and screen-reader behaviour.
 */
import * as React from "react";
import { VISIT_OUTCOMES } from "@/lib/maintenance/visit-outcomes";

export function OutcomeChoice({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const name = React.useId();
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-1 text-[0.8125rem] font-[600]">Outcome</legend>
      {VISIT_OUTCOMES.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={
              "flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--e-radius)] border px-3 py-2 focus-within:outline focus-within:outline-2 " +
              (checked
                ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]")
            }
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-[hsl(var(--e-gold))]"
            />
            <span className="min-w-0">
              <span className="block text-[0.875rem] font-[600]">{option.label}</span>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{option.hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
