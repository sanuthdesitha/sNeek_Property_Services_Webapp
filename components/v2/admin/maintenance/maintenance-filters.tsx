"use client";

/**
 * Maintenance filters (board "Maintenance"): search, Property, Priority,
 * Category, Reported by, Assigned to, Client price and Client sees it. From
 * 640px up they sit in one row of chips; on a phone they are behind "Filter"
 * in a bottom sheet holding the very same controls (EFilterBar). Every change
 * is written to the URL and starts the list again at page 1.
 */
import * as React from "react";
import { MaintenanceCategory, MaintenancePriority, MaintenanceSource } from "@prisma/client";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EFilterBar, EFilterBarInlineOnly, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { ESelect } from "@/components/v2/admin/estate-kit";
import { CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/maintenance/labels";
import type { MaintenancePriceFilter, MaintenanceVisibilityFilter } from "@/lib/maintenance/admin-list-types";
import { CLEARED_FILTERS, type MaintenanceView } from "./maintenance-view";

export type FilterPropertyOption = { id: string; name: string; suburb: string | null };
export type FilterWorkerOption = { id: string; name: string };

const PRICE_LABELS: Record<Exclude<MaintenancePriceFilter, "any">, string> = {
  NOT_SENT: "Not sent",
  PENDING: "Awaiting",
  APPROVED: "Approved",
  DECLINED: "Declined",
};

const VISIBLE_LABELS: Record<Exclude<MaintenanceVisibilityFilter, "any">, string> = {
  yes: "Client sees it",
  no: "Internal only",
};

const SOURCE_FILTER_LABELS: Record<MaintenanceSource, string> = {
  CLEANER: "Cleaner",
  QA: "QA inspector",
  CLIENT: "Client",
  ADMIN: "Office",
};

const SELECT_CLASS = "h-9 max-sm:h-11 max-sm:text-base";

function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function ChoiceChips<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ key: T; label: string }>; value: T; onChange: (key: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button key={option.key} type="button" aria-pressed={value === option.key} onClick={() => onChange(option.key)} className={cn(E_CHIP_CLASS, value === option.key && E_CHIP_ON_CLASS)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CheckList<T extends string>({ label, options, values, onChange }: { label: string; options: Array<{ key: T; label: string }>; values: T[]; onChange: (next: T[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.key} className="flex min-h-9 cursor-pointer items-center gap-2 text-[0.8125rem] max-sm:min-h-11">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))] max-sm:h-5 max-sm:w-5" checked={values.includes(option.key)} onChange={() => onChange(toggle(values, option.key))} />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

export function MaintenanceFilters({
  view,
  onChange,
  properties,
  workers,
  total,
}: {
  view: MaintenanceView;
  onChange: (patch: Partial<MaintenanceView>) => void;
  properties: FilterPropertyOption[];
  workers: FilterWorkerOption[] | null;
  /** The current total, for the sheet's "Show N items"; null while unknown. */
  total: number | null;
}) {
  const [search, setSearch] = React.useState(view.q);
  React.useEffect(() => setSearch(view.q), [view.q]);

  const propertyName = properties.find((property) => property.id === view.propertyId)?.name ?? (view.propertyId ? "Chosen property" : null);
  const assignedLabel =
    view.assigned === "none" ? "Nobody" : view.assigned.startsWith("worker:") ? workers?.find((worker) => `worker:${worker.id}` === view.assigned)?.name ?? "Chosen worker" : view.assigned.startsWith("user:") ? "Chosen person" : null;
  const priorityLabel = view.priority.length > 0 ? view.priority.map((value) => PRIORITY_LABELS[value]).join(", ") : null;
  const sourceLabel = view.source.length > 0 ? view.source.map((value) => SOURCE_FILTER_LABELS[value]).join(", ") : null;
  const priceLabel = view.price === "any" ? null : PRICE_LABELS[view.price];
  const visibleLabel = view.visible === "any" ? null : VISIBLE_LABELS[view.visible];
  const periodLabel = view.period === "visits-week" ? "Visits this week" : view.period === "resolved-month" ? "Resolved this month" : null;

  const active: EActiveFilter[] = [
    ...(view.q.trim() ? [{ key: "q", label: `Search: ${view.q.trim()}`, onRemove: () => onChange({ q: "" }) }] : []),
    ...(propertyName ? [{ key: "property", label: `Property: ${propertyName}`, onRemove: () => onChange({ propertyId: "" }) }] : []),
    ...(priorityLabel ? [{ key: "priority", label: `Priority: ${priorityLabel}`, onRemove: () => onChange({ priority: [] }) }] : []),
    ...(view.category ? [{ key: "category", label: `Category: ${CATEGORY_LABELS[view.category]}`, onRemove: () => onChange({ category: "" }) }] : []),
    ...(sourceLabel ? [{ key: "source", label: `Reported by: ${sourceLabel}`, onRemove: () => onChange({ source: [] }) }] : []),
    ...(assignedLabel ? [{ key: "assigned", label: `Assigned to: ${assignedLabel}`, onRemove: () => onChange({ assigned: "any" }) }] : []),
    ...(priceLabel ? [{ key: "price", label: `Client price: ${priceLabel}`, onRemove: () => onChange({ price: "any" }) }] : []),
    ...(visibleLabel ? [{ key: "visible", label: visibleLabel, onRemove: () => onChange({ visible: "any" }) }] : []),
    ...(periodLabel ? [{ key: "period", label: periodLabel, onRemove: () => onChange({ period: "any" }) }] : []),
  ];
  const clear = () => onChange(CLEARED_FILTERS);

  return (
    <EFilterBar
      label="Filters"
      active={active}
      onClear={clear}
      resultLabel={total === null ? "Show items" : `Show ${total} ${total === 1 ? "item" : "items"}`}
    >
      <label className="min-w-0 max-sm:block max-sm:w-full">
        <span className="sr-only">Search items</span>
        <input
          type="search"
          value={search}
          placeholder="Search item, property, person"
          onChange={(event) => {
            setSearch(event.target.value);
            onChange({ q: event.target.value });
          }}
          className="h-8 w-[220px] rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] max-sm:h-11 max-sm:w-full max-sm:text-base"
        />
      </label>
      <EFilterPopover label="Property" value={propertyName} emptyValue={undefined}>
        <ESelect aria-label="Property" value={view.propertyId} onChange={(event) => onChange({ propertyId: event.target.value })} className={SELECT_CLASS}>
          <option value="">All {properties.length} Airbnb properties</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>{property.suburb ? `${property.name} · ${property.suburb}` : property.name}</option>
          ))}
        </ESelect>
      </EFilterPopover>
      <EFilterPopover label="Priority" value={priorityLabel}>
        <CheckList label="Priority" options={Object.values(MaintenancePriority).map((key) => ({ key, label: PRIORITY_LABELS[key] }))} values={view.priority} onChange={(priority) => onChange({ priority })} />
      </EFilterPopover>
      <EFilterPopover label="Category" value={view.category ? CATEGORY_LABELS[view.category] : null}>
        <ESelect aria-label="Category" value={view.category} onChange={(event) => onChange({ category: event.target.value as MaintenanceView["category"] })} className={SELECT_CLASS}>
          <option value="">All categories</option>
          {Object.values(MaintenanceCategory).map((key) => (
            <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>
          ))}
        </ESelect>
      </EFilterPopover>
      <EFilterPopover label="Reported by" value={sourceLabel}>
        <CheckList label="Reported by" options={Object.values(MaintenanceSource).map((key) => ({ key, label: SOURCE_FILTER_LABELS[key] ?? SOURCE_LABELS[key] }))} values={view.source} onChange={(source) => onChange({ source })} />
      </EFilterPopover>
      <EFilterPopover label="Assigned to" value={assignedLabel}>
        <ESelect aria-label="Assigned to" value={view.assigned} onChange={(event) => onChange({ assigned: event.target.value })} className={SELECT_CLASS}>
          <option value="any">Anyone or nobody</option>
          <option value="none">Nobody assigned</option>
          {(workers ?? []).map((worker) => (
            <option key={worker.id} value={`worker:${worker.id}`}>{worker.name}</option>
          ))}
          {view.assigned.startsWith("user:") ? <option value={view.assigned}>Chosen person</option> : null}
        </ESelect>
        {workers === null ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Loading workers…</p> : null}
      </EFilterPopover>
      <EFilterPopover label="Client price" value={priceLabel}>
        <ChoiceChips<MaintenancePriceFilter>
          label="Client price"
          value={view.price}
          onChange={(price) => onChange({ price: price === view.price ? "any" : price })}
          options={(Object.keys(PRICE_LABELS) as Array<Exclude<MaintenancePriceFilter, "any">>).map((key) => ({ key, label: PRICE_LABELS[key] }))}
        />
      </EFilterPopover>
      <EFilterPopover label="Client sees it" value={visibleLabel}>
        <ChoiceChips<MaintenanceVisibilityFilter>
          label="Client sees it"
          value={view.visible}
          onChange={(visible) => onChange({ visible })}
          options={[{ key: "any", label: "Both" }, { key: "yes", label: "Client sees it" }, { key: "no", label: "Internal only" }]}
        />
      </EFilterPopover>
      {periodLabel ? (
        <button type="button" onClick={() => onChange({ period: "any" })} className={cn(E_CHIP_CLASS, E_CHIP_ON_CLASS, "max-sm:hidden")} aria-label={`Remove filter ${periodLabel}`}>
          {periodLabel} ✕
        </button>
      ) : null}
      <EFilterBarInlineOnly>
        <span className="min-w-0 flex-1 max-sm:hidden" />
        <EButton variant="ghost" size="sm" onClick={clear} disabled={active.length === 0}>Clear filters</EButton>
      </EFilterBarInlineOnly>
    </EFilterBar>
  );
}
