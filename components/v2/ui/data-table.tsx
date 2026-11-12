"use client";

/**
 * ESTATE data table: sortable headers, optional row selection and explicit
 * loading / error / empty / stale states.
 *
 * - A sortable header is a real <button>; its <th> carries aria-sort.
 * - Sorting is controlled: the table reports the requested key and direction
 *   and the caller re-reads the server. It never sorts the rows itself, so a
 *   paged list cannot pretend one page is the whole order.
 * - Selection is controlled and keyed by row id. The header checkbox selects or
 *   clears the rows on THIS page only.
 * - The table scrolls inside its own labelled region, so a wide table never
 *   widens the page at 390px.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "./primitives";

export type SortDirection = "asc" | "desc";
export type TableSort<TSort extends string> = { key: TSort; dir: SortDirection };

export type EDataColumn<TRow, TSort extends string = string> = {
  /** Stable column id. */
  key: string;
  header: React.ReactNode;
  /** When set, the header becomes a sort button for this server sort key. */
  sortKey?: TSort;
  /** Direction used the first time this column is chosen. Defaults to asc. */
  firstDir?: SortDirection;
  align?: "left" | "right" | "center";
  className?: string;
  cell: (row: TRow) => React.ReactNode;
};

export type EDataSelection<TRow> = {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Accessible name for a row checkbox, e.g. "Select INV-0042". */
  rowLabel: (row: TRow) => string;
  disabled?: boolean;
};

export type EDataTableProps<TRow, TSort extends string = string> = {
  /** Names the scroll region and the table, e.g. "Client invoices". */
  label: string;
  columns: Array<EDataColumn<TRow, TSort>>;
  rows: TRow[];
  rowKey: (row: TRow) => string;
  sort?: TableSort<TSort> | null;
  onSortChange?: (next: TableSort<TSort>) => void;
  selection?: EDataSelection<TRow>;
  /** A read is in flight. With rows on screen they stay visible (aria-busy). */
  loading?: boolean;
  /** The latest read failed. With rows on screen this is the stale state. */
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: React.ReactNode;
  emptyDescription?: React.ReactNode;
  /** Minimum table width before the region scrolls. */
  minWidth?: string;
  className?: string;
  /**
   * Optional group rows (e.g. one per day). Every row in `rows` must appear in
   * exactly one group, in display order; the page checkbox still uses `rows`.
   */
  groups?: Array<{ key: string; label: React.ReactNode; rows: TRow[] }>;
  /** Mouse convenience: clicking a row's non-interactive area. Keep a real control in the row for keyboards. */
  onRowClick?: (row: TRow) => void;
  /** The row shown elsewhere (e.g. in a side panel), highlighted. */
  activeRowKey?: string | null;
  /** Cell padding, e.g. for a density preference. */
  cellPadding?: string;
};

const INTERACTIVE = "a, button, input, select, textarea, label, [role='menuitem'], [role='checkbox']";

const ALIGN: Record<NonNullable<EDataColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function ariaSortFor(active: boolean, dir: SortDirection | undefined): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function SortIcon({ active, dir }: { active: boolean; dir?: SortDirection }) {
  if (!active) return <ArrowUpDown aria-hidden className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" />;
}

function PageCheckbox<TRow>({
  rows,
  rowKey,
  selection,
}: {
  rows: TRow[];
  rowKey: (row: TRow) => string;
  selection: EDataSelection<TRow>;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const pageIds = rows.map(rowKey);
  const selectedOnPage = pageIds.filter((id) => selection.selected.has(id)).length;
  const all = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const some = selectedOnPage > 0 && !all;

  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  function toggle() {
    const next = new Set(selection.selected);
    if (all) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    selection.onChange(next);
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))]"
      aria-label="Select all on this page"
      checked={all}
      disabled={selection.disabled || pageIds.length === 0}
      onChange={toggle}
    />
  );
}

function StateMessage({
  role,
  title,
  description,
  action,
}: {
  role?: "status" | "alert";
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div role={role} className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="e-display-sm">{title}</p>
      {description ? (
        <p className="max-w-md text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry?: () => void }) {
  if (!onRetry) return null;
  return (
    <EButton size="sm" variant="outline" onClick={onRetry}>
      <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again
    </EButton>
  );
}

export function EDataTable<TRow, TSort extends string = string>({
  label,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  selection,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = "Nothing to show",
  emptyDescription,
  minWidth = "52rem",
  className,
  groups,
  onRowClick,
  activeRowKey = null,
  cellPadding = "px-3 py-2.5",
}: EDataTableProps<TRow, TSort>) {
  const hasRows = rows.length > 0;

  if (!hasRows && loading) {
    return (
      <StateMessage
        role="status"
        title={
          <span className="inline-flex items-center gap-2">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…
          </span>
        }
      />
    );
  }
  if (!hasRows && error) {
    return (
      <StateMessage role="alert" title="Could not load this list" description={error} action={<RetryButton onRetry={onRetry} />} />
    );
  }
  if (!hasRows) {
    return <StateMessage title={emptyTitle} description={emptyDescription} />;
  }

  function requestSort(column: EDataColumn<TRow, TSort>) {
    if (!column.sortKey || !onSortChange) return;
    const active = sort?.key === column.sortKey;
    const dir: SortDirection = active ? (sort?.dir === "asc" ? "desc" : "asc") : (column.firstDir ?? "asc");
    onSortChange({ key: column.sortKey, dir });
  }

  function renderRow(row: TRow) {
    const id = rowKey(row);
    const checked = selection?.selected.has(id) ?? false;
    const active = activeRowKey !== null && activeRowKey === id;
    return (
      <tr
        key={id}
        data-active={active || undefined}
        onClick={onRowClick ? (event) => {
          if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
          onRowClick(row);
        } : undefined}
        className={cn(
          "hover:bg-[hsl(var(--e-surface-raised)/0.6)]",
          onRowClick && "cursor-pointer",
          (checked || active) && "bg-[hsl(var(--e-primary-soft))] hover:bg-[hsl(var(--e-primary-soft))]",
          active && "shadow-[inset_3px_0_0_hsl(var(--e-primary))]",
        )}
      >
        {selection ? (
          <td className={cn("w-[34px] align-middle", cellPadding)}>
            <input
              type="checkbox"
              className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))]"
              aria-label={selection.rowLabel(row)}
              checked={checked}
              disabled={selection.disabled}
              onChange={() => {
                const next = new Set(selection.selected);
                if (checked) next.delete(id);
                else next.add(id);
                selection.onChange(next);
              }}
            />
          </td>
        ) : null}
        {columns.map((column) => (
          <td key={column.key} className={cn("align-middle", cellPadding, ALIGN[column.align ?? "left"], column.className)}>
            {column.cell(row)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      {error ? (
        // Stale: the rows below are the last good read, not the current one.
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2 text-[0.8125rem]"
        >
          <span>Showing the last loaded list. {error}</span>
          <RetryButton onRetry={onRetry} />
        </div>
      ) : null}
      <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
        <table className="w-full text-[0.875rem]" style={{ minWidth }} aria-busy={loading || undefined}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-[hsl(var(--e-border))]">
              {selection ? (
                <th scope="col" className="w-[34px] bg-[hsl(var(--e-surface-raised))] px-3 py-2">
                  <PageCheckbox rows={rows} rowKey={rowKey} selection={selection} />
                </th>
              ) : null}
              {columns.map((column) => {
                const active = Boolean(column.sortKey) && sort?.key === column.sortKey;
                // The concept's `table.t th`: 11px, muted, on the raised surface.
                const thClass = cn(
                  "whitespace-nowrap bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.6875rem] font-semibold text-[hsl(var(--e-muted-foreground))]",
                  ALIGN[column.align ?? "left"],
                  column.className,
                );
                if (!column.sortKey) {
                  return (
                    <th key={column.key} scope="col" className={thClass}>
                      {column.header}
                    </th>
                  );
                }
                return (
                  <th key={column.key} scope="col" className={thClass} aria-sort={ariaSortFor(active, sort?.dir)}>
                    <button
                      type="button"
                      onClick={() => requestSort(column)}
                      disabled={!onSortChange}
                      className={cn(
                        "inline-flex min-h-[1.75rem] items-center gap-1 hover:text-[hsl(var(--e-foreground))]",
                        active && "text-[hsl(var(--e-primary))]",
                        "rounded-[var(--e-radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                        column.align === "right" ? "flex-row-reverse" : "",
                      )}
                    >
                      {column.header}
                      <SortIcon active={active} dir={sort?.dir} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--e-border))]">
            {(groups ?? [{ key: "", label: null, rows }]).map((group) => (
              <React.Fragment key={group.key || "rows"}>
                {groups ? (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={columns.length + (selection ? 1 : 0)}
                      className="bg-[hsl(var(--e-background))] px-3 py-1.5 text-left text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]"
                    >
                      {group.label}
                    </th>
                  </tr>
                ) : null}
                {group.rows.map((row) => renderRow(row))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
