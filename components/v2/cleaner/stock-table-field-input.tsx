"use client";

/**
 * Cleaner control for the "Stock used" table (field type `inventory`).
 *
 * One row per stock item of the job's property that the question shows
 * (lib/forms/stock-table.ts `stockTableRows`). Each row has the item name,
 * unit, the on-hand figure ("not known" when the system has none) and a
 * stepper with direct entry for how many were USED this clean.
 *
 * A row starts unanswered (empty, "Not answered yet"); "−" on an unanswered
 * row records an explicit 0 ("none used"), "+" records 1, and emptying the box
 * makes it unanswered again. Typed text that is not a whole number from 0 is
 * kept as typed so the shared validator can refuse it in words.
 *
 * Answers go into the shared `stockTableUsage` map (one answer per item), so a
 * Kitchen table and an "All items" table on one form show the same number.
 *
 * States: no stock list (builder preview) → example rows; read failed → a
 * Try again button, never "no items"; property does not track stock → says
 * so; no items in the area → "No kitchen items are set up for this property."
 */
import * as React from "react";
import { Minus, PackageMinus, Plus, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { E_FIELD_CLASS } from "@/components/v2/cleaner/fields";
import {
  readStockTableConfig,
  readStockTableUsage,
  readStockUsedValue,
  stockAreaLabel,
  stockTableRows,
  type StockArea,
  type StockTableItem,
  type StockTableShow,
  type StockTableStock,
} from "@/lib/forms/stock-table";
import type { FormField } from "@/lib/forms/types";

export type StockTableFieldInputProps = {
  field: FormField;
  answers: Record<string, unknown>;
  /** Writes the whole shared usage map under STOCK_TABLE_USAGE_KEY. */
  onUsageChange: (next: Record<string, unknown>) => void;
  /** The property's stock list; undefined = a builder preview with no property. */
  stock: StockTableStock | undefined;
  /** Re-read the job form (and so the stock list). */
  onRetry?: () => void;
  disabled?: boolean;
  error?: boolean;
};

const EXAMPLE_ITEMS: Record<StockArea, Array<{ name: string; unit: string }>> = {
  kitchen: [
    { name: "Dishwashing liquid", unit: "bottle" },
    { name: "Coffee capsules", unit: "capsule" },
  ],
  bathroom: [
    { name: "Toilet paper", unit: "roll" },
    { name: "Hand soap", unit: "bottle" },
  ],
  laundry: [{ name: "Laundry liquid", unit: "bottle" }],
  other: [{ name: "Bin bags (large)", unit: "bag" }],
};

function exampleRows(show: StockTableShow): StockTableItem[] {
  const areas: StockArea[] = show === "all" ? ["kitchen", "bathroom", "other"] : [show];
  return areas.flatMap((area) =>
    EXAMPLE_ITEMS[area].map((item, index) => ({
      itemId: `example-${area}-${index}`,
      name: item.name,
      sku: null,
      unit: item.unit,
      location: null,
      area,
      onHand: null,
    })),
  );
}

/** "No kitchen items are set up for this property." / "No stock items …". */
export function emptyAreaMessage(show: StockTableShow): string {
  if (show === "all") return "No stock items are set up for this property.";
  if (show === "other") return "No other stock items are set up for this property.";
  return `No ${stockAreaLabel(show).toLowerCase()} items are set up for this property.`;
}

function onHandText(item: StockTableItem): string {
  if (item.onHand === null) return "On hand: not known";
  const unit = item.unit ? ` ${item.unit}` : "";
  return `On hand: ${item.onHand}${unit}`;
}

export function StockTableFieldInput({ field, answers, onUsageChange, stock, onRetry, disabled = false, error = false }: StockTableFieldInputProps) {
  const config = readStockTableConfig(field);
  const usage = readStockTableUsage(answers);
  const limited = config.itemRefs.length > 0 || config.legacyLocations.length > 0;
  const areaNote = config.show !== "all" ? `${stockAreaLabel(config.show)} items` : limited ? "Listed stock items" : "All stock items";

  const write = (itemId: string, value: number | string | undefined) => {
    const next = { ...readStockTableUsage(answers) };
    if (value === undefined) delete next[itemId];
    else next[itemId] = value;
    onUsageChange(next);
  };

  if (stock === undefined) {
    return (
      <div className="space-y-2">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {areaNote} of the job&apos;s property. Example rows; the cleaner sees the property&apos;s own stock.
        </p>
        <StockRows fieldId={field.id} rows={exampleRows(config.show)} usage={{}} write={() => {}} disabled fieldLabel={field.label} />
      </div>
    );
  }

  if (stock.status === "unavailable") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] p-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">
        <span className="min-w-0 flex-1">{stock.message} Your answers are kept.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3.5 font-[550] text-[hsl(var(--e-foreground))]"
          >
            <RotateCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (!stock.tracked) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">This property does not track stock, so there is nothing to record here.</p>;
  }

  const rows = stockTableRows(field, stock.items);
  if (rows.length === 0) {
    return <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{emptyAreaMessage(config.show)}</p>;
  }

  return (
    <div className={cn("space-y-2", error && "rounded-[var(--e-radius)] ring-1 ring-[hsl(var(--e-danger))] p-1")}>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        {areaNote}: enter how many you used this clean (0 if none).
      </p>
      <StockRows fieldId={field.id} rows={rows} usage={usage} write={write} disabled={disabled} fieldLabel={field.label} />
    </div>
  );
}

function StockRows({
  fieldId,
  rows,
  usage,
  write,
  disabled,
  fieldLabel,
}: {
  fieldId: string;
  rows: StockTableItem[];
  usage: Record<string, unknown>;
  write: (itemId: string, value: number | string | undefined) => void;
  disabled: boolean;
  fieldLabel: string;
}) {
  return (
    <ul aria-label={fieldLabel} className="space-y-2">
      {rows.map((row) => (
        <StockRow key={row.itemId} fieldId={fieldId} row={row} raw={usage[row.itemId]} write={write} disabled={disabled} />
      ))}
    </ul>
  );
}

function StockRow({
  fieldId,
  row,
  raw,
  write,
  disabled,
}: {
  fieldId: string;
  row: StockTableItem;
  raw: unknown;
  write: (itemId: string, value: number | string | undefined) => void;
  disabled: boolean;
}) {
  const value = readStockUsedValue(raw);
  const quantity = value.state === "answered" ? value.quantity : null;
  // The same item can appear in two tables (Kitchen and All items): ids are per question.
  const inputId = `stock-used-${fieldId}-${row.itemId}`;
  const statusId = `${inputId}-status`;

  const step = (delta: 1 | -1) => {
    if (quantity === null) {
      write(row.itemId, delta === 1 ? 1 : 0);
      return;
    }
    write(row.itemId, Math.max(0, quantity + delta));
  };

  const onType = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") write(row.itemId, undefined);
    else if (/^\d+$/.test(trimmed)) write(row.itemId, Number(trimmed));
    else write(row.itemId, trimmed);
  };

  const shown = raw === undefined || raw === null ? "" : String(raw);
  const status =
    value.state === "unanswered"
      ? "Not answered yet"
      : value.state === "invalid"
        ? `The amount used ${value.message}.`
        : quantity === 0
          ? "None used"
          : `${quantity}${row.unit ? ` ${row.unit}` : ""} used`;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2">
      <div className="min-w-0 flex-1 basis-40">
        <label htmlFor={inputId} className="flex items-start gap-1.5 break-words text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">
          <PackageMinus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-text-faint))]" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{row.name}</span>
        </label>
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {row.unit ? `Unit: ${row.unit} · ` : ""}
          {onHandText(row)}
        </p>
        <p
          id={statusId}
          className={cn(
            "text-[0.75rem]",
            value.state === "invalid" ? "font-[550] text-[hsl(var(--e-danger))]" : value.state === "unanswered" ? "text-[hsl(var(--e-warning))]" : "text-[hsl(var(--e-text-secondary))]",
          )}
        >
          {status}
        </p>
      </div>
      <div className="inline-flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={disabled || quantity === 0}
          onClick={() => step(-1)}
          aria-label={quantity === null ? `None used: ${row.name}` : `One fewer ${row.name}`}
          className="flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] disabled:opacity-50"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={shown}
          placeholder="–"
          disabled={disabled}
          aria-describedby={statusId}
          aria-invalid={value.state === "invalid" || undefined}
          onChange={(event) => onType(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              step(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              if (quantity !== 0) step(-1);
            }
          }}
          className={cn(E_FIELD_CLASS, "h-11 w-16 px-1 text-center text-[0.9375rem] font-semibold tabular-nums", value.state === "invalid" && "border-[hsl(var(--e-danger))]")}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => step(1)}
          aria-label={`One more ${row.name}`}
          className="flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
