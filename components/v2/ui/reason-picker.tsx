"use client";

/**
 * QUICK-PICK REASON for the confirmations that keep a required reason
 * (board "Confirmations and deletes", 2026-11-14).
 *
 * - One tap on a choice; "Other…" opens a one-line box that must not be empty.
 *   No minimum length.
 * - Native radio inputs inside a labelled radio group, drawn as chips with
 *   44px targets on a phone and visible keyboard focus.
 * - The value is kept by the owner (the dialog), so a failed save keeps it.
 *
 * The lists themselves live in the plain module lib/confirmations/reasons.ts.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { OTHER_REASON_ID, type ReasonChoice, type ReasonValue } from "@/lib/confirmations/reasons";

export type EReasonPickerProps = {
  label: string;
  choices: readonly ReasonChoice[];
  value: ReasonValue;
  onChange: (next: ReasonValue) => void;
  required?: boolean;
  disabled?: boolean;
  /** Called on Enter inside the "Other…" box, so Enter can confirm. */
  onSubmit?: () => void;
};

const CHIP =
  "inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-[0.8125rem] transition-colors max-sm:min-h-11 " +
  "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))] " +
  "has-[:checked]:border-[hsl(var(--e-primary))] has-[:checked]:bg-[hsl(var(--e-primary)/0.12)] has-[:checked]:font-[600] " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[hsl(var(--e-ring))] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

export function EReasonPicker({ label, choices, value, onChange, required = true, disabled = false, onSubmit }: EReasonPickerProps) {
  const id = React.useId();
  const name = `${id}-reason`;
  const otherOpen = value.choice === OTHER_REASON_ID;
  return (
    <div role="radiogroup" aria-labelledby={`${id}-label`} aria-required={required || undefined} className="space-y-2">
      <p id={`${id}-label`} className="text-[0.8125rem] font-[600]">
        {label}
        {required ? <span className="font-normal text-[hsl(var(--e-muted-foreground))]">, required</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <label key={choice.id} className={CHIP}>
            <input
              type="radio"
              name={name}
              value={choice.id}
              className="sr-only"
              checked={value.choice === choice.id}
              disabled={disabled}
              onChange={() => onChange({ ...value, choice: choice.id })}
            />
            {choice.label}
          </label>
        ))}
      </div>
      {otherOpen ? (
        <div>
          <label htmlFor={`${id}-other`} className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
            Say why
          </label>
          <input
            id={`${id}-other`}
            type="text"
            autoFocus
            maxLength={2000}
            disabled={disabled}
            value={value.note}
            onChange={(event) => onChange({ ...value, note: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && onSubmit) {
                event.preventDefault();
                onSubmit();
              }
            }}
            className={cn(
              "mt-1 h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem]",
              "focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:opacity-60 max-sm:h-11 max-sm:text-[16px]",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
