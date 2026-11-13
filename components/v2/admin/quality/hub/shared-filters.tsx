"use client";

/**
 * The one shared filter row: search, Property, Category and "Has open fixes",
 * plus removable chips for a cleaner or inspector drill-down. Options come
 * from /api/admin/quality/options (the database), never from loaded rows.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EFilterBar, EFilterBarInlineOnly, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { ESelect } from "@/components/v2/admin/estate-kit";
import type { IssueListFilters } from "@/lib/quality/types";
import type { QualityOption, QualityOptions } from "./hub-types";

const SEARCH_DELAY_MS = 300;

function labelOf(options: QualityOption[] | undefined, id: string): string | null {
  if (!id) return null;
  return options?.find((option) => option.id === id)?.label ?? "Selected";
}

function OptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: QualityOption[] | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
      {label}
      <ESelect value={value} onChange={(event) => onChange(event.target.value)} disabled={!options}>
        <option value="">{options ? "Any" : "Loading…"}</option>
        {(options ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </ESelect>
    </label>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className={cn(E_CHIP_CLASS, E_CHIP_ON_CLASS, "pr-1")}>
      <span className="max-w-[12rem] truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="rounded-full p-0.5 hover:bg-[hsl(var(--e-primary)/0.12)]">
        <X aria-hidden className="h-3 w-3" />
      </button>
    </span>
  );
}

/** One removable chip per shared filter in use (the phone filter bar). */
export function sharedActiveFilters(filters: IssueListFilters, options: QualityOptions | null, onChange: (patch: Partial<IssueListFilters>) => void): EActiveFilter[] {
  const active: EActiveFilter[] = [];
  if (filters.q.trim()) active.push({ key: "q", label: `Search: ${filters.q.trim()}`, onRemove: () => onChange({ q: "" }) });
  const property = labelOf(options?.properties, filters.propertyId);
  if (property) active.push({ key: "property", label: `Property: ${property}`, onRemove: () => onChange({ propertyId: "" }) });
  const category = labelOf(options?.categories, filters.category);
  if (category) active.push({ key: "category", label: `Category: ${category}`, onRemove: () => onChange({ category: "" }) });
  if (filters.openFixes) active.push({ key: "openFixes", label: "Has open fixes", onRemove: () => onChange({ openFixes: false }) });
  const cleaner = labelOf(options?.cleaners, filters.cleanerId);
  if (cleaner) active.push({ key: "cleaner", label: `Cleaner: ${cleaner}`, onRemove: () => onChange({ cleanerId: "" }) });
  const inspector = labelOf(options?.inspectors, filters.raisedById);
  if (inspector) active.push({ key: "inspector", label: `Raised by: ${inspector}`, onRemove: () => onChange({ raisedById: "" }) });
  return active;
}

export function SharedFilters({
  filters,
  options,
  optionsError,
  searchLabel,
  onChange,
  phoneExtra,
  phoneExtraActive = [],
}: {
  filters: IssueListFilters;
  options: QualityOptions | null;
  optionsError: string | null;
  searchLabel: string;
  onChange: (patch: Partial<IssueListFilters>) => void;
  /** Phones only: a tab's own filters, shown in the same sheet (the Issues tab's status filters). */
  phoneExtra?: React.ReactNode;
  /** Chips for `phoneExtra`'s filters in use. */
  phoneExtraActive?: EActiveFilter[];
}) {
  const [draft, setDraft] = React.useState(filters.q);
  const committed = React.useRef(filters.q);

  // Follow an external change (link, back) without clobbering typing.
  React.useEffect(() => {
    if (filters.q !== committed.current) {
      committed.current = filters.q;
      setDraft(filters.q);
    }
  }, [filters.q]);

  React.useEffect(() => {
    if (draft === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = draft;
      onChange({ q: draft });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, onChange]);

  /** Applies a change at once; a cleared search also clears the box so the delay cannot bring it back. */
  const changeNow = (patch: Partial<IssueListFilters>) => {
    if (patch.q !== undefined) {
      committed.current = patch.q;
      setDraft(patch.q);
    }
    onChange(patch);
  };

  const cleanerLabel = labelOf(options?.cleaners, filters.cleanerId);
  const inspectorLabel = labelOf(options?.inspectors, filters.raisedById);

  return (
    // Phones: every filter sits behind one Filter button with removable chips; unchanged from 640px.
    <EFilterBar
      label="Filter quality"
      active={[...sharedActiveFilters(filters, options, changeNow), ...phoneExtraActive]}
      onClear={() => {
        changeNow({ q: "", propertyId: "", category: "", openFixes: false, cleanerId: "", raisedById: "" });
        phoneExtraActive.forEach((filter) => filter.onRemove?.());
      }}
    >
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={searchLabel}
        placeholder={searchLabel}
        className="h-[34px] w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))] sm:w-[220px]"
      />
      <EFilterPopover label="Property" value={labelOf(options?.properties, filters.propertyId)}>
        <OptionSelect label="Property" value={filters.propertyId} options={options?.properties} onChange={(propertyId) => onChange({ propertyId })} />
      </EFilterPopover>
      <EFilterPopover label="Category" value={labelOf(options?.categories, filters.category)}>
        <OptionSelect label="Category" value={filters.category} options={options?.categories} onChange={(category) => onChange({ category })} />
      </EFilterPopover>
      <button
        type="button"
        aria-pressed={filters.openFixes}
        onClick={() => onChange({ openFixes: !filters.openFixes })}
        className={cn(E_CHIP_CLASS, filters.openFixes && E_CHIP_ON_CLASS)}
      >
        Has open fixes
      </button>
      <EFilterBarInlineOnly>
        {cleanerLabel ? <RemovableChip label={`Cleaner: ${cleanerLabel}`} onRemove={() => onChange({ cleanerId: "" })} /> : null}
        {inspectorLabel ? <RemovableChip label={`Raised by: ${inspectorLabel}`} onRemove={() => onChange({ raisedById: "" })} /> : null}
        <span className="hidden min-w-0 flex-1 sm:block" />
      </EFilterBarInlineOnly>
      {phoneExtra}
      <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        {optionsError ? `Filter options could not be loaded. ${optionsError}` : "All tabs share the period and these filters."}
      </span>
    </EFilterBar>
  );
}
