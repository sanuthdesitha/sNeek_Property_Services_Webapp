"use client";

/**
 * "Stock counts from this job were applied" — the explicit choice inside the
 * Reset job dialog (owner decision 2026-11-12). Lists each applied count (item,
 * counted value, on hand now) and asks "Reverse these counts" or "Keep them".
 * Nothing is pre-selected; the dialog keeps its confirm button disabled until
 * one is chosen, and the server refuses a reset without it.
 */
import { Boxes } from "lucide-react";
import {
  APPLIED_COUNT_CHOICE_HINT,
  APPLIED_COUNT_CHOICE_LABEL,
  formatCountQuantity,
  type AppliedCountChoice,
  type AppliedStockCount,
} from "@/lib/inventory/stock-count-reset-format";

const CHOICES: AppliedCountChoice[] = ["REVERSE", "KEEP"];

export function AppliedStockCountChoice({
  counts,
  choice,
  onChoiceChange,
  disabled,
  name = "applied-stock-counts",
}: {
  counts: AppliedStockCount[];
  choice: AppliedCountChoice | null;
  onChoiceChange: (next: AppliedCountChoice) => void;
  disabled?: boolean;
  name?: string;
}) {
  if (counts.length === 0) return null;
  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.5)] p-3"
      aria-describedby={`${name}-help`}
    >
      <legend className="flex items-center gap-1.5 px-1 text-[0.875rem] font-[550]">
        <Boxes className="h-4 w-4" aria-hidden="true" /> Stock counts from this job were applied
      </legend>
      <p id={`${name}-help`} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        The cleaner&apos;s form set on-hand stock for these items when the clean was approved. Choose what happens to them
        before resetting.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-left text-[0.8125rem]">
          <thead className="text-[0.6875rem] uppercase tracking-wide text-[hsl(var(--e-text-faint))]">
            <tr>
              <th scope="col" className="py-1 pr-3 font-[550]">Item</th>
              <th scope="col" className="py-1 pr-3 font-[550]">Counted</th>
              <th scope="col" className="py-1 pr-3 font-[550]">On hand now</th>
              <th scope="col" className="py-1 font-[550]">Before the count</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((row) => (
              <tr key={row.observationId} className="border-t border-[hsl(var(--e-border))]">
                <td className="py-1.5 pr-3">{row.itemName}</td>
                <td className="py-1.5 pr-3 tabular-nums">{formatCountQuantity(row.count, row.unit)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{formatCountQuantity(row.onHandNow, row.unit)}</td>
                <td className="py-1.5 tabular-nums">{formatCountQuantity(row.previousOnHand, row.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div role="radiogroup" aria-label="What happens to these stock counts" aria-required="true" className="grid gap-2 sm:grid-cols-2">
        {CHOICES.map((value) => (
          <label
            key={value}
            className={[
              "flex cursor-pointer items-start gap-2 rounded-[var(--e-radius)] border p-2.5",
              choice === value ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]" : "border-[hsl(var(--e-border))]",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            <input
              type="radio"
              name={name}
              value={value}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
              checked={choice === value}
              disabled={disabled}
              onChange={() => onChoiceChange(value)}
            />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-[550]">{APPLIED_COUNT_CHOICE_LABEL[value]}</span>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{APPLIED_COUNT_CHOICE_HINT[value]}</span>
            </span>
          </label>
        ))}
      </div>
      {choice === null ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Choose one to continue.</p>
      ) : null}
    </fieldset>
  );
}
