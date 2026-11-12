"use client";

/**
 * ESTATE filter bar (board "Admin phone", 2026-11): one wrapper for a page's
 * filter controls that changes shape on a phone.
 *
 * - From 640px up the children render inline, exactly where and how they did
 *   before (the bar is the same flex row), followed by `tools`.
 * - Below 640px the children collapse behind ONE "Filter" button that shows
 *   how many filters are active and opens a bottom sheet holding the very same
 *   controls. Active filters show as removable chips under the bar.
 *
 * The children are mounted in exactly one place at a time (inline, or in the
 * open sheet), so labels stay unique and the page keeps owning filter state
 * (normally the URL); nothing is copied or re-implemented for the phone.
 * `EFilterPopover` and `EFilterChips` read `useInFilterSheet()` and lay
 * themselves out as plain labelled sections inside the sheet.
 *
 * Usage: wrap the existing controls and pass the active filters.
 *   <EFilterBar active={[{ key: "client", label: "Client: Harbour View", onRemove }]} onClear={clear}
 *     resultLabel="Show 128 jobs" tools={<LayoutSwitch />}>
 *     <SearchInput /> <EFilterPopover …/> …
 *   </EFilterBar>
 */
import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "./bottom-sheet";
import { EButton } from "./primitives";
import { useIsPhone } from "./use-phone";
import { E_CHIP_CLASS } from "./filter-chips";
import { FilterSheetProvider, useInFilterSheet } from "./filter-sheet-context";

export { useInFilterSheet } from "./filter-sheet-context";

export type EActiveFilter = {
  key: string;
  /** What is active, in words: "Client: Harbour View Stays". */
  label: string;
  /** Removes just this filter. Omit when it cannot be removed on its own. */
  onRemove?: () => void;
};

export type EFilterBarProps = {
  /** Names the sheet and the phone button's group, e.g. "Filter jobs". */
  label?: string;
  active?: EActiveFilter[];
  /** Clears every filter (the page's own "Clear filters"). */
  onClear?: () => void;
  /** The sheet's close button text, e.g. "Show 128 jobs". */
  resultLabel?: string;
  /** Display tools that are not filters (layout, columns): always visible. */
  tools?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function EFilterBar({ label = "Filters", active = [], onClear, resultLabel, tools, children, className }: EFilterBarProps) {
  const phone = useIsPhone();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!phone) setOpen(false);
  }, [phone]);
  const count = active.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Desktop (and the first paint everywhere): the controls inline. */}
      {phone ? null : <div className="contents max-sm:hidden">{children}</div>}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(E_CHIP_CLASS, "min-h-11 gap-2 px-3.5 text-[0.8125rem] sm:hidden", count > 0 && "border-[hsl(var(--e-primary)/0.35)] text-[hsl(var(--e-primary))]")}
      >
        <SlidersHorizontal aria-hidden className="h-4 w-4" />
        Filter{count > 0 ? <span className="e-tnum"> · {count}</span> : null}
        {count > 0 ? <span className="sr-only"> active</span> : null}
      </button>
      {tools}
      {count > 0 ? (
        <ul aria-label="Active filters" className="flex basis-full gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:hidden">
          {active.map((filter) => (
            <li key={filter.key} className="shrink-0">
              {filter.onRemove ? (
                <button
                  type="button"
                  onClick={filter.onRemove}
                  aria-label={`Remove filter ${filter.label}`}
                  className="inline-flex min-h-11 max-w-[16rem] items-center gap-1 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-primary-soft))] pl-3 pr-2 text-[0.75rem] font-[600] text-[hsl(var(--e-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                >
                  <span className="truncate">{filter.label}</span>
                  <X aria-hidden className="h-3.5 w-3.5 shrink-0" />
                </button>
              ) : (
                <span className="inline-flex min-h-8 items-center rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-primary-soft))] px-3 text-[0.75rem] font-[600] text-[hsl(var(--e-primary))]">{filter.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <EBottomSheet
        open={phone && open}
        onOpenChange={setOpen}
        title={label}
        headerAction={onClear ? <EButton variant="ghost" size="sm" disabled={count === 0} onClick={onClear}>Clear filters</EButton> : null}
        footer={<EButton className="w-full" onClick={() => setOpen(false)}>{resultLabel ?? "Done"}</EButton>}
      >
        <FilterSheetProvider>
          <div className="flex flex-col gap-4">{phone && open ? children : null}</div>
        </FilterSheetProvider>
      </EBottomSheet>
    </div>
  );
}

/**
 * Children shown only in the inline row, never in the phone sheet: for a
 * page's own "Clear filters" when the sheet already offers one beside its title.
 */
export function EFilterBarInlineOnly({ children }: { children: React.ReactNode }) {
  return useInFilterSheet() ? null : <>{children}</>;
}
