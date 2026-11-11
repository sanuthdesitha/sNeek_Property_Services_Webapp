"use client";

/**
 * Builder settings for the structured question types:
 *  - Table: columns (label, cell type, required, choices), fixed rows or
 *    "cleaner can add rows" with minimum and maximum;
 *  - Stock count: which inventory item is counted, from the same catalogue
 *    the form's stock selection uses (GET /api/admin/inventory/items). The
 *    item's unit is copied onto the question so the phone can show it.
 */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { readTableConfig, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "@/lib/forms/structured-answers";
import type { FormField, TableCellType, TableColumn, TableConfig } from "@/lib/forms/types";
import { PanelSection as Section } from "./panel-section";

const CELL_TYPES: Array<[TableCellType, string]> = [
  ["text", "Text"],
  ["number", "Number"],
  ["yesno", "Yes / No"],
  ["choice", "Choice"],
];

function nextColumnId(columns: TableColumn[]): string {
  let n = columns.length + 1;
  while (columns.some((column) => column.id === `c${n}`)) n += 1;
  return `c${n}`;
}

function intOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

export function TableSettings({ field, onUpdate }: { field: FormField; onUpdate: (field: FormField) => void }) {
  const table = readTableConfig(field.table);
  const save = (next: TableConfig) => onUpdate({ ...field, table: next });
  const setColumn = (index: number, patch: Partial<TableColumn>) =>
    save({ ...table, columns: table.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)) });

  return (
    <Section title="Table" defaultOpen>
      <fieldset className="space-y-3">
        <legend className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Columns</legend>
        {table.columns.map((column, index) => (
          <div key={column.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
            <div className="flex items-end gap-2">
              <EField label={`Column ${index + 1} label`} className="min-w-0 flex-1">
                <EInput value={column.label} maxLength={60} onChange={(e) => setColumn(index, { label: e.target.value })} />
              </EField>
              <button
                type="button"
                aria-label={`Remove column ${column.label || index + 1}`}
                disabled={table.columns.length <= 1}
                onClick={() => save({ ...table, columns: table.columns.filter((_, i) => i !== index) })}
                className="mb-1 rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))] disabled:opacity-40"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <EField label="Cell">
                <ESelect value={column.cellType} onChange={(e) => setColumn(index, { cellType: e.target.value as TableCellType })}>
                  {CELL_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </ESelect>
              </EField>
              <label className="flex items-center justify-between gap-2 self-end pb-2 text-[0.8125rem]">
                Required
                <ESwitch checked={Boolean(column.required)} onCheckedChange={(on) => setColumn(index, { required: on || undefined })} />
              </label>
            </div>
            {column.cellType === "choice" ? (
              <EField label="Choices (comma separated)">
                <EInput
                  value={(column.options ?? []).join(", ")}
                  onChange={(e) => setColumn(index, { options: e.target.value.split(",").map((option) => option.trim()).filter(Boolean) })}
                />
              </EField>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          disabled={table.columns.length >= TABLE_MAX_COLUMNS}
          onClick={() => save({ ...table, columns: [...table.columns, { id: nextColumnId(table.columns), label: "New column", cellType: "text" }] })}
          className="inline-flex items-center gap-1 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden /> Add column
        </button>
      </fieldset>

      <EField label="Rows">
        <ESelect
          value={table.rowMode}
          onChange={(e) =>
            save(
              e.target.value === "fixed"
                ? { columns: table.columns, rowMode: "fixed", rowLabels: table.rowLabels?.length ? table.rowLabels : ["Row 1"] }
                : { columns: table.columns, rowMode: "dynamic", minRows: 1, maxRows: 10 },
            )
          }
        >
          <option value="dynamic">Cleaner can add rows</option>
          <option value="fixed">Fixed rows</option>
        </ESelect>
      </EField>
      {table.rowMode === "fixed" ? (
        <EField label="Row names (one per line)" hint={`Up to ${TABLE_MAX_ROWS}.`}>
          <textarea
            rows={4}
            className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2 text-[0.8125rem]"
            value={(table.rowLabels ?? []).join("\n")}
            onChange={(e) => save({ ...table, rowLabels: e.target.value.split("\n") })}
            onBlur={(e) => save({ ...table, rowLabels: e.target.value.split("\n").map((label) => label.trim()).filter(Boolean) })}
          />
        </EField>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <EField label="Minimum rows">
            <EInput type="number" min={0} max={TABLE_MAX_ROWS} value={table.minRows ?? ""} onChange={(e) => save({ ...table, minRows: intOrUndefined(e.target.value) })} />
          </EField>
          <EField label="Maximum rows">
            <EInput type="number" min={1} max={TABLE_MAX_ROWS} value={table.maxRows ?? ""} onChange={(e) => save({ ...table, maxRows: intOrUndefined(e.target.value) })} />
          </EField>
        </div>
      )}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">On a phone each row is a card with every column labelled.</p>
    </Section>
  );
}

type CatalogItem = { id: string; name: string; unit?: string | null; category?: string | null; isActive?: boolean };

export function StockCountSettings({ field, onUpdate }: { field: FormField; onUpdate: (field: FormField) => void }) {
  const [items, setItems] = React.useState<CatalogItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/inventory/items", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The stock list could not be loaded (${res.status}).`))))
      .then((body: unknown) => {
        if (controller.signal.aborted) return;
        setItems(Array.isArray(body) ? (body as CatalogItem[]).filter((item) => item.isActive !== false) : []);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The stock list could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  const choose = (id: string) => {
    const item = items?.find((entry) => entry.id === id);
    if (!item) return onUpdate({ ...field, stockItemId: undefined, stockItemName: undefined });
    onUpdate({ ...field, stockItemId: item.id, stockItemName: item.name, unit: item.unit || undefined });
  };

  return (
    <Section title="Stock count" defaultOpen>
      <EField label="Item counted" hint="From the stock catalogue. A property that does not stock it shows the question, but no urgent need can be raised there.">
        {items === null && !error ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Loading the stock list…</p>
        ) : (
          <ESelect value={field.stockItemId ?? ""} onChange={(e) => choose(e.target.value)} disabled={!items}>
            <option value="">Choose an item…</option>
            {field.stockItemId && !items?.some((item) => item.id === field.stockItemId) ? (
              <option value={field.stockItemId}>{field.stockItemName ?? "Item not in the catalogue"}</option>
            ) : null}
            {(items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.unit ? ` (${item.unit})` : ""}
              </option>
            ))}
          </ESelect>
        )}
      </EField>
      {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        The cleaner enters a whole number{field.unit ? ` of ${field.unit}` : ""}. The count is kept on the submission.
      </p>
    </Section>
  );
}
