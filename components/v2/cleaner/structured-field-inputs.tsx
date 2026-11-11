"use client";

/**
 * Cleaner controls for the structured question types.
 *
 *  TableFieldInput       one stacked card per row (a wide grid is unusable at
 *                        390px); every cell has its own label ("Row 2: Count"),
 *                        so a screen reader names it without the grid.
 *  StockCountFieldInput  the item and unit, and a whole-number count.
 *
 * Answer shapes are the ones lib/forms/structured-answers.ts validates on the
 * phone and the server: table → array of row objects keyed by column id;
 * stock count → { itemId, count }.
 */
import * as React from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EInput, ESelect } from "@/components/v2/cleaner/fields";
import { readTableConfig, tableRowLimits, type TableRow } from "@/lib/forms/structured-answers";
import type { FormField, TableColumn } from "@/lib/forms/types";

type TableInputProps = {
  field: FormField;
  value: unknown;
  onChange: (next: TableRow[] | undefined) => void;
  disabled?: boolean;
  error?: boolean;
};

function rowsFrom(value: unknown): TableRow[] {
  return Array.isArray(value) ? value.map((row) => (row && typeof row === "object" && !Array.isArray(row) ? { ...(row as TableRow) } : {})) : [];
}

function YesNoCell({ id, value, disabled, onChange }: { id: string; value: unknown; disabled?: boolean; onChange: (next: boolean | undefined) => void }) {
  const choice = (answer: boolean, text: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={value === answer}
      onClick={() => onChange(value === answer ? undefined : answer)}
      className={cn(
        "min-h-10 rounded-[var(--e-radius-pill)] border px-4 text-[0.8125rem] font-[550] disabled:opacity-50",
        value === answer
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))]",
      )}
    >
      {text}
    </button>
  );
  return (
    <div id={id} role="group" className="flex gap-2">
      {choice(true, "Yes")}
      {choice(false, "No")}
    </div>
  );
}

function TableCell({
  column,
  rowName,
  inputId,
  value,
  disabled,
  onChange,
}: {
  column: TableColumn;
  rowName: string;
  inputId: string;
  value: unknown;
  disabled?: boolean;
  onChange: (next: unknown) => void;
}) {
  const label = `${rowName}: ${column.label}`;
  if (column.cellType === "yesno") {
    return (
      <div className="space-y-1">
        <span id={`${inputId}-label`} className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
          {column.label}
          {column.required ? <span className="text-[hsl(var(--e-danger))]"> *</span> : null}
        </span>
        <div aria-labelledby={`${inputId}-label`} aria-label={label}>
          <YesNoCell id={inputId} value={value} disabled={disabled} onChange={onChange} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
        {column.label}
        {column.required ? <span className="text-[hsl(var(--e-danger))]"> *</span> : null}
      </label>
      {column.cellType === "choice" ? (
        <ESelect id={inputId} aria-label={label} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Choose…</option>
          {(column.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </ESelect>
      ) : (
        <EInput
          id={inputId}
          aria-label={label}
          type={column.cellType === "number" ? "number" : "text"}
          inputMode={column.cellType === "number" ? "decimal" : undefined}
          value={value === undefined || value === null ? "" : String(value)}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === "") onChange(undefined);
            else onChange(column.cellType === "number" ? Number(raw) : raw);
          }}
        />
      )}
    </div>
  );
}

export function TableFieldInput({ field, value, onChange, disabled, error }: TableInputProps) {
  const config = readTableConfig(field.table);
  const limits = tableRowLimits(config);
  const baseId = React.useId();
  const stored = rowsFrom(value);
  const fixed = config.rowMode === "fixed";
  const shownCount = fixed ? limits.max : Math.max(stored.length, limits.min, 1);
  const rows: TableRow[] = Array.from({ length: Math.min(shownCount, limits.max) }, (_, index) => stored[index] ?? {});

  const emit = (next: TableRow[]) => {
    const hasContent = next.some((row) => Object.values(row).some((cell) => cell !== undefined && cell !== ""));
    onChange(hasContent || (!fixed && next.length > 1) ? next : undefined);
  };
  const setCell = (rowIndex: number, columnId: string, cell: unknown) => {
    const next = rows.map((row, index) => {
      if (index !== rowIndex) return row;
      const updated = { ...row };
      if (cell === undefined) delete updated[columnId];
      else updated[columnId] = cell;
      return updated;
    });
    emit(next);
  };

  if (config.columns.length === 0) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">This table has no columns yet.</p>;
  }

  return (
    <div className={cn("space-y-2", error && "rounded-[var(--e-radius)] ring-1 ring-[hsl(var(--e-danger))] p-1")}>
      {rows.map((row, rowIndex) => {
        const rowName = fixed ? config.rowLabels?.[rowIndex] || `Row ${rowIndex + 1}` : `Row ${rowIndex + 1}`;
        return (
          <fieldset
            key={rowIndex}
            className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3"
          >
            <legend className="flex w-full items-center justify-between gap-2 px-1 text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">
              <span className="min-w-0 break-words">{rowName}</span>
            </legend>
            {config.columns.map((column) => (
              <TableCell
                key={column.id}
                column={column}
                rowName={rowName}
                inputId={`${baseId}-${rowIndex}-${column.id}`}
                value={row[column.id]}
                disabled={disabled}
                onChange={(cell) => setCell(rowIndex, column.id, cell)}
              />
            ))}
            {!fixed && rows.length > Math.max(limits.min, 1) ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => emit(rows.filter((_, index) => index !== rowIndex))}
                className="inline-flex min-h-10 items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))] disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove {rowName.toLowerCase()}
              </button>
            ) : null}
          </fieldset>
        );
      })}
      {!fixed ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={disabled || rows.length >= limits.max}
            onClick={() => emit([...rows, {}])}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3.5 text-[0.8125rem] font-[550] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add row
          </button>
          <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            {limits.min > 0 ? `At least ${limits.min}, ` : ""}up to {limits.max} rows
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function StockCountFieldInput({
  field,
  value,
  onChange,
  disabled,
  error,
}: {
  field: FormField;
  value: unknown;
  onChange: (next: { itemId: string; count: number } | undefined) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const count = value && typeof value === "object" && "count" in (value as Record<string, unknown>) ? (value as { count: unknown }).count : undefined;
  const itemId = typeof field.stockItemId === "string" ? field.stockItemId : "";
  const unit = field.unit?.trim();
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        <Package className="h-3.5 w-3.5" aria-hidden />
        {field.stockItemName ? field.stockItemName : "Stock item"}
        {unit ? ` · counted in ${unit}` : ""}
      </p>
      {itemId ? (
        <div className="flex items-center gap-2">
          <EInput
            aria-label={field.label || field.id}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={typeof count === "number" && Number.isFinite(count) ? String(count) : ""}
            disabled={disabled}
            className={cn("w-32", error && "border-[hsl(var(--e-danger))]")}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(raw.trim() === "" ? undefined : { itemId, count: Number(raw) });
            }}
          />
          {unit ? <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{unit}</span> : null}
        </div>
      ) : (
        <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">This question does not name an item yet. Tell the office.</p>
      )}
    </div>
  );
}
