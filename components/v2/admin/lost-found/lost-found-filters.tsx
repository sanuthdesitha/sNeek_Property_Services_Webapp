"use client";

/**
 * Stage tabs (with the server's real counts) and the filter row as drawn:
 * search, Property, Found date, Value, the holding-period flag, and the sort
 * control. Every value lives in the URL view.
 */
import { NEW_ITEM_FLAG_DAYS } from "@/lib/lost-found/holding";
import { cn } from "@/lib/utils";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { CLOSED_STATUSES, LOST_FOUND_STAGE_LABELS, lostFoundStatusLabel } from "@/lib/lost-found/status";
import { LOST_FOUND_TABS, VALUE_FILTERS, VALUE_FILTER_LABEL, type LostFoundSort, type LostFoundTab } from "@/lib/lost-found/list-options";
import type { LostFoundView } from "./lost-found-view";

const TAB_LABEL: Record<LostFoundTab, string> = { ...LOST_FOUND_STAGE_LABELS, all: "All" };

export function LostFoundTabs({ active, counts, onSelect }: { active: LostFoundTab; counts: Partial<Record<LostFoundTab, number>> | null; onSelect: (tab: LostFoundTab) => void }) {
  return (
    <nav aria-label="Item stages" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {LOST_FOUND_TABS.map((tab) => {
          const isActive = tab === active;
          const count = counts?.[tab];
          return (
            <a
              key={tab}
              href={`/v2/admin/lost-found?stage=${tab}`}
              aria-current={isActive ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                onSelect(tab);
              }}
              className={cn(
                "-mb-px inline-flex min-h-[2.5rem] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                isActive ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              {TAB_LABEL[tab]}
              {typeof count === "number" && tab !== "closed" && tab !== "all" ? <span className="e-tnum">{count}</span> : null}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

const SORT_OPTIONS: Array<{ value: string; label: string; sort: LostFoundSort; dir: "asc" | "desc" }> = [
  { value: "found:asc", label: "Sort: oldest first", sort: "found", dir: "asc" },
  { value: "found:desc", label: "Sort: newest first", sort: "found", dir: "desc" },
  { value: "item:asc", label: "Sort: item A–Z", sort: "item", dir: "asc" },
  { value: "property:asc", label: "Sort: property A–Z", sort: "property", dir: "asc" },
  { value: "guest:asc", label: "Sort: guest A–Z", sort: "guest", dir: "asc" },
  { value: "stored:asc", label: "Sort: stored at A–Z", sort: "stored", dir: "asc" },
  { value: "status:asc", label: "Sort: status", sort: "status", dir: "asc" },
];

export function LostFoundFilters({
  view,
  onChange,
  properties,
  holdingDays,
  unprocessedCount = null,
}: {
  view: LostFoundView;
  onChange: (patch: Partial<LostFoundView>) => void;
  properties: Array<{ id: string; name: string }>;
  holdingDays: number | null;
  /** Items still at New found more than NEW_ITEM_FLAG_DAYS ago (a real count), or null while unknown. */
  unprocessedCount?: number | null;
}) {
  const property = properties.find((option) => option.id === view.propertyId);
  const dateValue = view.from || view.to ? `${view.from || "…"} to ${view.to || "…"}` : null;
  const sortValue = `${view.sort}:${view.dir}`;
  const knownSort = SORT_OPTIONS.some((option) => option.value === sortValue);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EInput type="search" aria-label="Search" placeholder="Search item, guest, property" value={view.q} onChange={(event) => onChange({ q: event.target.value })} className="h-8 w-full sm:w-[240px]" />
      <EFilterPopover label="Property" value={property?.name ?? (view.propertyId ? "Selected" : null)}>
        <EField label="Property">
          <ESelect value={view.propertyId} onChange={(event) => onChange({ propertyId: event.target.value })}>
            <option value="">All properties</option>
            {properties.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </ESelect>
        </EField>
      </EFilterPopover>
      <EFilterPopover label="Found date" value={dateValue}>
        <EField label="From"><EInput type="date" value={view.from} onChange={(event) => onChange({ from: event.target.value })} /></EField>
        <EField label="To"><EInput type="date" value={view.to} onChange={(event) => onChange({ to: event.target.value })} /></EField>
        {dateValue ? <EButton size="sm" variant="ghost" onClick={() => onChange({ from: "", to: "" })}>Clear dates</EButton> : null}
      </EFilterPopover>
      <EFilterPopover label="Value" value={view.value !== "any" ? VALUE_FILTER_LABEL[view.value] : null}>
        <EField label="Estimated value">
          <ESelect value={view.value} onChange={(event) => onChange({ value: event.target.value as LostFoundView["value"] })}>
            {VALUE_FILTERS.map((value) => <option key={value} value={value}>{VALUE_FILTER_LABEL[value]}</option>)}
          </ESelect>
        </EField>
      </EFilterPopover>
      <button type="button" aria-pressed={view.holding} onClick={() => onChange({ holding: !view.holding })} className={cn(E_CHIP_CLASS, view.holding && E_CHIP_ON_CLASS)}>
        {holdingDays ? `Held over ${holdingDays} days` : "Past holding period"}
      </button>
      <button type="button" aria-pressed={view.staleNew} onClick={() => onChange({ staleNew: !view.staleNew })} className={cn(E_CHIP_CLASS, view.staleNew && E_CHIP_ON_CLASS)}>
        New over {NEW_ITEM_FLAG_DAYS} days{typeof unprocessedCount === "number" ? ` ${unprocessedCount}` : ""}
      </button>
      {view.tab === "closed" ? (
        <ESelect aria-label="Closed as" value={view.closedAs} onChange={(event) => onChange({ closedAs: event.target.value })} className="h-8 w-auto">
          <option value="">Every closed status</option>
          {CLOSED_STATUSES.map((status) => <option key={status} value={status}>{lostFoundStatusLabel(status)}</option>)}
        </ESelect>
      ) : null}
      <span className="min-w-0 flex-1" />
      <ESelect
        aria-label="Sort"
        value={knownSort ? sortValue : ""}
        onChange={(event) => {
          const option = SORT_OPTIONS.find((candidate) => candidate.value === event.target.value);
          if (option) onChange({ sort: option.sort, dir: option.dir });
        }}
        className="h-8 w-auto"
      >
        {knownSort ? null : <option value="">Sort: from the table</option>}
        {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </ESelect>
    </div>
  );
}
