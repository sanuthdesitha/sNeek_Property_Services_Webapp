"use client";

/**
 * Phone-only parts of EDataTable (below 640px). The header row is hidden
 * there, so sorting is offered as one labelled select plus a direction button,
 * controlled exactly like the header buttons (the caller re-reads the server).
 * When the table has selection, a "Select" toggle shows the row checkboxes
 * (they stay hidden otherwise, to keep the cards clean); "Cancel" hides them
 * and clears the selection, like the bulk bar's Clear.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { EDataColumn, SortDirection, TableSort } from "./data-table";

/** Header text used as the phone label of a cell; only plain text headers qualify. */
export function headerText(header: React.ReactNode): string | undefined {
  if (typeof header === "string") return header.trim() || undefined;
  if (typeof header === "number") return String(header);
  return undefined;
}

export function SortIcon({ active, dir }: { active: boolean; dir?: SortDirection }) {
  if (!active) return <ArrowUpDown aria-hidden className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" />;
}

type PhoneTableBarProps<TRow, TSort extends string> = {
  columns: Array<EDataColumn<TRow, TSort>>;
  sort: TableSort<TSort> | null;
  onSortChange?: (next: TableSort<TSort>) => void;
  label: string;
  /** Checkboxes are showing. */
  selecting: boolean;
  /** Present when the table has selection. */
  onSelectMode?: (on: boolean) => void;
  selectionDisabled?: boolean;
};

const CONTROL = "rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]";

export function PhoneTableBar<TRow, TSort extends string>({ columns, sort, onSortChange, label, selecting, onSelectMode, selectionDisabled }: PhoneTableBarProps<TRow, TSort>) {
  const id = React.useId();
  const sortable = onSortChange ? columns.filter((column) => column.sortKey && headerText(column.header)) : [];
  if (sortable.length === 0 && !onSelectMode) return null;
  const active = sortable.find((column) => column.sortKey === sort?.key);
  const dir: SortDirection = sort?.dir ?? "asc";

  return (
    <div className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] px-3 py-2 sm:hidden">
      {sortable.length > 0 && onSortChange ? (
        <>
          <label htmlFor={id} className="text-[0.75rem] font-semibold text-[hsl(var(--e-muted-foreground))]">
            Sort by
          </label>
          <select
            id={id}
            aria-label={`Sort ${label} by`}
            className={`min-h-11 min-w-0 flex-1 px-2 text-[0.8125rem] ${CONTROL}`}
            value={active?.sortKey ?? ""}
            onChange={(event) => {
              const column = sortable.find((candidate) => candidate.sortKey === event.target.value);
              if (column?.sortKey) onSortChange({ key: column.sortKey, dir: column.firstDir ?? "asc" });
            }}
          >
            {active ? null : <option value="">Default order</option>}
            {sortable.map((column) => (
              <option key={column.key} value={column.sortKey}>
                {headerText(column.header)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!active}
            aria-label={dir === "asc" ? "Ascending. Switch to descending" : "Descending. Switch to ascending"}
            onClick={() => {
              if (active?.sortKey) onSortChange({ key: active.sortKey, dir: dir === "asc" ? "desc" : "asc" });
            }}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40 ${CONTROL}`}
          >
            <SortIcon active={Boolean(active)} dir={dir} />
          </button>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {onSelectMode ? (
        <button
          type="button"
          disabled={selectionDisabled && !selecting}
          onClick={() => onSelectMode(!selecting)}
          className={`inline-flex h-11 shrink-0 items-center px-3 text-[0.8125rem] font-[550] disabled:opacity-40 ${CONTROL}`}
        >
          {selecting ? "Cancel" : "Select"}<span className="sr-only">{selecting ? " selecting rows" : " rows"}</span>
        </button>
      ) : null}
    </div>
  );
}
