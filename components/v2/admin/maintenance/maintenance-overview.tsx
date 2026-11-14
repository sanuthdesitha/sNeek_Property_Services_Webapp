"use client";

/**
 * The six tiles and the status bar above the Maintenance list (board
 * "Maintenance"). Tiles are filters, not decoration: each one applies its own
 * filter set and reads as current while the list matches it. Before the first
 * answer, or when the list could not be loaded, a tile shows "–", never 0.
 *
 * Phones: three compact tiles (Nobody assigned, Visits this week, Resolved
 * this month; the open, urgent and waiting counts are in the heading line)
 * and the status bar as one swipeable row of chips.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import type { MaintenanceStatusCounts, MaintenanceStatusTab, MaintenanceTiles } from "@/lib/maintenance/admin-list-types";
import { CLEARED_FILTERS, type MaintenanceView } from "./maintenance-view";
import { money } from "./maintenance-format";

type TileKey = "open" | "urgent" | "nobody" | "waiting" | "visits" | "resolved";

const TILE_FILTERS: Record<TileKey, Partial<MaintenanceView>> = {
  open: { ...CLEARED_FILTERS, status: "open" },
  urgent: { ...CLEARED_FILTERS, status: "open", priority: ["URGENT"] },
  nobody: { ...CLEARED_FILTERS, status: "open", assigned: "none" },
  waiting: { ...CLEARED_FILTERS, status: "open", price: "PENDING" },
  visits: { ...CLEARED_FILTERS, status: "open", period: "visits-week" },
  resolved: { ...CLEARED_FILTERS, status: "RESOLVED", period: "resolved-month" },
};

function matches(view: MaintenanceView, patch: Partial<MaintenanceView>): boolean {
  return (Object.keys(patch) as Array<keyof MaintenanceView>).every((key) => JSON.stringify(view[key]) === JSON.stringify(patch[key]));
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

type TileSpec = { key: TileKey; label: string; value: number | null; sub: string | null; danger?: boolean; phone?: boolean };

function tileSpecs(tiles: MaintenanceTiles | null): TileSpec[] {
  return [
    { key: "open", label: "Open", value: tiles?.open ?? null, sub: "all not resolved or dismissed" },
    { key: "urgent", label: "Urgent", value: tiles?.urgent ?? null, sub: tiles ? (tiles.urgentNobody > 0 ? `${tiles.urgentNobody} ${tiles.urgentNobody === 1 ? "has" : "have"} nobody assigned` : "all have someone on them") : null, danger: true },
    { key: "nobody", label: "Nobody assigned", value: tiles?.nobody ?? null, sub: tiles ? (tiles.nobodyOldestDays === null ? "none waiting" : `oldest ${plural(tiles.nobodyOldestDays, "day")}`) : null, phone: true },
    { key: "waiting", label: "Waiting on client price", value: tiles?.waitingClient ?? null, sub: tiles ? (tiles.waitingClientQuoted === null ? (tiles.waitingClient > 0 ? "no amount recorded" : "none waiting") : `${money(tiles.waitingClientQuoted)} quoted`) : null },
    { key: "visits", label: "Visits this week", value: tiles?.visitsWeek ?? null, sub: tiles ? `${tiles.visitsToday} today` : null, phone: true },
    { key: "resolved", label: "Resolved this month", value: tiles?.resolvedMonth ?? null, sub: tiles ? `${tiles.dismissedMonth} dismissed` : null, phone: true },
  ];
}

export function MaintenanceTilesRow({ tiles, view, onApply }: { tiles: MaintenanceTiles | null; view: MaintenanceView; onApply: (patch: Partial<MaintenanceView>) => void }) {
  return (
    <div role="group" aria-label="Summary, each tile filters the list" className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-6">
      {tileSpecs(tiles).map((tile) => {
        const on = matches(view, TILE_FILTERS[tile.key]);
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={on}
            onClick={() => onApply(TILE_FILTERS[tile.key])}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-[12px] border bg-[hsl(var(--e-surface))] px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              on ? "border-[hsl(var(--e-primary)/0.45)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]",
              !tile.phone && "max-sm:hidden",
              "max-sm:min-h-11 max-sm:px-2.5 max-sm:py-2",
            )}
          >
            <span className="text-[0.71875rem] font-[500] text-[hsl(var(--e-muted-foreground))] max-sm:order-2 max-sm:text-[0.6875rem]">{tile.label}</span>
            <span className={cn("e-numeral text-[1.625rem] leading-none max-sm:order-1 max-sm:text-[1.25rem]", tile.danger && (tile.value ?? 0) > 0 && "text-[hsl(var(--e-danger))]")}>
              {tile.value === null ? "–" : tile.value}
            </span>
            <span className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))] max-sm:hidden">{tile.sub ?? "–"}</span>
          </button>
        );
      })}
    </div>
  );
}

const STATUS_SEGMENTS: Array<{ key: MaintenanceStatusTab; label: string; short: string; end?: boolean }> = [
  { key: "open", label: "All open", short: "All open" },
  { key: "OPEN", label: "Open", short: "Open" },
  { key: "ACKNOWLEDGED", label: "Acknowledged", short: "Ack." },
  { key: "IN_PROGRESS", label: "In progress", short: "In progress" },
  { key: "ORDERED", label: "Ordered", short: "Ordered" },
  { key: "RESOLVED", label: "Resolved", short: "Resolved", end: true },
  { key: "DISMISSED", label: "Dismissed", short: "Dismissed", end: true },
];

export function MaintenanceStatusBar({ counts, active, onChange }: { counts: MaintenanceStatusCounts | null; active: MaintenanceStatusTab; onChange: (tab: MaintenanceStatusTab) => void }) {
  return (
    <div
      role="group"
      aria-label="Status"
      className={cn(
        "flex overflow-hidden rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
        "max-sm:-mx-1 max-sm:gap-1.5 max-sm:overflow-x-auto max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-1 max-sm:pb-0.5 max-sm:[scrollbar-width:none]",
      )}
    >
      {STATUS_SEGMENTS.map((segment, index) => {
        const pressed = segment.key === active;
        const count = counts ? counts[segment.key] : null;
        return (
          <button
            key={segment.key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(segment.key)}
            className={cn(
              // Desktop: the board's segmented bar.
              "flex flex-1 items-baseline justify-between gap-1.5 px-2.5 py-1.5 text-left text-[0.75rem] text-[hsl(var(--e-text-secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--e-ring))] sm:min-h-9",
              index > 0 && "sm:border-l sm:border-[hsl(var(--e-border))]",
              segment.end && !pressed && "sm:bg-[hsl(var(--e-surface-raised))]",
              pressed && "sm:bg-[hsl(var(--e-primary-soft))] sm:font-[600] sm:text-[hsl(var(--e-primary))]",
              // Phone: chips in one swipeable row.
              "max-sm:hidden",
            )}
          >
            <span className="truncate">{segment.label}</span>
            <b className="e-tnum text-[0.9375rem] text-[hsl(var(--e-foreground))]">{count ?? "–"}</b>
          </button>
        );
      })}
      {STATUS_SEGMENTS.map((segment) => {
        const pressed = segment.key === active;
        const count = counts ? counts[segment.key] : null;
        return (
          <button
            key={`phone-${segment.key}`}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(segment.key)}
            className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS, "shrink-0 sm:hidden")}
          >
            {segment.short} <span className="e-tnum">{count ?? "–"}</span>
          </button>
        );
      })}
    </div>
  );
}
