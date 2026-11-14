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
 * - From 640px up the table scrolls inside its own labelled region. Below
 *   640px (phones) it is one DOM laid out as stacked rows: the first column is
 *   the row title, the other columns sit two across under their header text,
 *   and a "Sort by" control replaces the hidden header buttons. Nothing has to
 *   be scrolled sideways. Row checkboxes stay hidden on a phone until "Select"
 *   is turned on (or something is already selected), to keep the cards clean;
 *   selection itself is unchanged. A column marked `phoneTitle` becomes the
 *   card's title instead of the first column.
 */
import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "./primitives";
import { PhoneTableBar, SortIcon, headerText } from "./data-table-phone";

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
  /** Phones: this column is the card's title (default: the first column). */
  phoneTitle?: boolean;
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
  /**
   * Flagged rows (tone band, 2026-11): a class for the row's leading cells
   * (the checkbox cell and the title column), e.g. `toneRowCellClass(tone)`.
   * Return undefined for a row with nothing to flag. Never a left line.
   */
  leadCellClassName?: (row: TRow) => string | undefined;
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
  leadCellClassName,
}: EDataTableProps<TRow, TSort>) {
  const [phoneSelecting, setPhoneSelecting] = React.useState(false);
  const hasRows = rows.length > 0;
  // Phones show checkboxes only in Select mode, or while rows are selected.
  const showPhoneChecks = Boolean(selection) && (phoneSelecting || (selection?.selected.size ?? 0) > 0);
  const titleIndex = Math.max(0, columns.findIndex((column) => column.phoneTitle));

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
    const leadClass = leadCellClassName?.(row);
    return (
      <tr
        key={id}
        data-active={active || undefined}
        onClick={onRowClick ? (event) => {
          if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
          onRowClick(row);
        } : undefined}
        className={cn(
          "max-sm:flex max-sm:flex-wrap max-sm:items-start max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-3",
          "hover:bg-[hsl(var(--e-surface-raised)/0.6)]",
          onRowClick && "cursor-pointer",
          // Selected and active rows take a soft primary tint; no inset left line.
          (checked || active) && "bg-[hsl(var(--e-primary-soft))] hover:bg-[hsl(var(--e-primary-soft))]",
        )}
      >
        {selection ? (
          <td className={cn("w-[34px] align-middle max-sm:-order-1 max-sm:w-auto max-sm:!p-0 max-sm:pt-0.5", cellPadding, leadClass, !showPhoneChecks && "max-sm:hidden")}>
            <input
              type="checkbox"
              className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))] max-sm:h-6 max-sm:w-6"
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
        {columns.map((column, index) => {
          const isTitle = index === titleIndex;
          const phoneLabel = isTitle ? undefined : headerText(column.header);
          return (
            <td
              key={column.key}
              data-label={phoneLabel}
              className={cn(
                "align-middle",
                cellPadding,
                ALIGN[column.align ?? "left"],
                column.className,
                isTitle && leadClass,
                // Phone: no cell padding, left aligned; title first, then pairs.
                "max-sm:!w-auto max-sm:min-w-0 max-sm:!p-0 max-sm:!text-left",
                isTitle && "max-sm:order-first max-sm:flex-1 max-sm:basis-[60%] max-sm:text-[0.9375rem]",
                !isTitle && phoneLabel && "max-sm:basis-[calc(50%-0.375rem)] max-sm:before:block max-sm:before:text-[0.6875rem] max-sm:before:font-semibold max-sm:before:text-[hsl(var(--e-muted-foreground))] max-sm:before:content-[attr(data-label)]",
                !isTitle && !phoneLabel && "max-sm:flex max-sm:basis-full max-sm:flex-wrap max-sm:items-center max-sm:gap-2",
              )}
            >
              {column.cell(row)}
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <PhoneTableBar
        columns={columns}
        sort={sort ?? null}
        onSortChange={onSortChange}
        label={label}
        selecting={showPhoneChecks}
        onSelectMode={selection ? (on) => {
          setPhoneSelecting(on);
          if (!on && selection.selected.size > 0) selection.onChange(new Set());
        } : undefined}
        selectionDisabled={selection?.disabled}
      />
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
      <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] max-sm:overflow-x-visible">
        <table
          className="w-full text-[0.875rem] max-sm:block sm:min-w-[var(--e-table-min-width)]"
          style={{ "--e-table-min-width": minWidth } as React.CSSProperties}
          aria-busy={loading || undefined}
        >
          <caption className="sr-only">{label}</caption>
          <thead className={cn("max-sm:block", !showPhoneChecks && "max-sm:hidden")}>
            <tr className="border-b border-[hsl(var(--e-border))] max-sm:flex max-sm:items-center max-sm:gap-2 max-sm:bg-[hsl(var(--e-surface-raised))]">
              {selection ? (
                <th scope="col" className="w-[34px] bg-[hsl(var(--e-surface-raised))] px-3 py-2 max-sm:flex max-sm:min-h-11 max-sm:w-auto max-sm:items-center max-sm:gap-2 max-sm:after:text-[0.75rem] max-sm:after:font-normal max-sm:after:text-[hsl(var(--e-muted-foreground))] max-sm:after:content-['Select_all_on_this_page']">
                  <PageCheckbox rows={rows} rowKey={rowKey} selection={selection} />
                </th>
              ) : null}
              {columns.map((column) => {
                const active = Boolean(column.sortKey) && sort?.key === column.sortKey;
                // The concept's `table.t th`: 11px, muted, on the raised surface.
                const thClass = cn(
                  "max-sm:hidden",
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
          <tbody className="divide-y divide-[hsl(var(--e-border))] max-sm:block">
            {(groups ?? [{ key: "", label: null, rows }]).map((group) => (
              <React.Fragment key={group.key || "rows"}>
                {groups ? (
                  <tr className="max-sm:block">
                    <th
                      scope="colgroup"
                      colSpan={columns.length + (selection ? 1 : 0)}
                      className="bg-[hsl(var(--e-background))] px-3 py-1.5 text-left text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))] max-sm:block"
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
