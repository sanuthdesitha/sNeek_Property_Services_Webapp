"use client";

/**
 * Suppliers on a phone (board "M-SuppliersApprovals"): the directory table as
 * cards, rendered only below 640px (the caller gates on useIsPhone). Same
 * entries, same sort, same Open and "⋯" menu as the table rows; a supplier
 * that needs attention gets a tinted title band with its written reason.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EToneBand, ETonePill } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import { TYPE_LABELS, type DirectoryEntry, type DirectorySort } from "@/lib/suppliers/directory-view";
import { scheduleStated } from "@/lib/laundry/partner-schedule";

const SORT_OPTIONS: ReadonlyArray<{ id: DirectorySort; label: string }> = [
  { id: "name", label: "Supplier" },
  { id: "type", label: "Type" },
  { id: "logins", label: "Portal logins" },
  { id: "progress", label: "In progress" },
  { id: "ontime", label: "On time" },
];

type Props = {
  entries: DirectoryEntry[];
  openKey: string | null;
  sort: DirectorySort;
  dir: "asc" | "desc";
  /** Same toggle as the table headers: the same column flips direction, another starts ascending. */
  onSort: (sort: DirectorySort) => void;
  onOpen: (entry: DirectoryEntry) => void;
  menuFor: (entry: DirectoryEntry) => ERowMenuItem[];
};

function attentionPill(entry: DirectoryEntry): string | null {
  if (entry.lateCount) return `${entry.lateCount} late`;
  return entry.attention[0] ?? null;
}

function CardHeader({ entry }: { entry: DirectoryEntry }) {
  const noSchedule = entry.row?.laundry && entry.row.laundry.schedule && !scheduleStated(entry.row.laundry.schedule);
  return (
    <div className="min-w-0 flex-1">
      <b className="block text-[0.9375rem] font-[650] [overflow-wrap:anywhere]">{entry.name}</b>
      <span className="block text-[0.75rem] opacity-80 [overflow-wrap:anywhere]">
        {entry.types.map((type) => TYPE_LABELS[type]).join(" · ")}
        {entry.terms ? ` · ${entry.terms}` : ""}
      </span>
      <span className="block text-[0.75rem] opacity-80 [overflow-wrap:anywhere]">{entry.subtitle}</span>
      {noSchedule ? <span className="block text-[0.75rem] opacity-80">no pickup schedule</span> : null}
    </div>
  );
}

export function SupplierCards({ entries, openKey, sort, dir, onSort, onOpen, menuFor }: Props) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] px-3 py-2">
        <label htmlFor="supplier-phone-sort" className="text-[0.75rem] font-semibold text-[hsl(var(--e-muted-foreground))]">Sort by</label>
        <select
          id="supplier-phone-sort"
          value={sort}
          onChange={(event) => onSort(event.target.value as DirectorySort)}
          className="min-h-11 min-w-0 flex-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 text-[16px]"
        >
          {SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button
          type="button"
          aria-label={dir === "asc" ? "Ascending. Switch to descending" : "Descending. Switch to ascending"}
          onClick={() => onSort(sort)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
        >
          {dir === "asc" ? <ArrowUp aria-hidden className="h-4 w-4" /> : <ArrowDown aria-hidden className="h-4 w-4" />}
        </button>
      </div>
      <ul aria-label="Suppliers" className="flex flex-col gap-2.5 p-2.5">
        {entries.map((entry) => {
          const reason = attentionPill(entry);
          const selected = entry.key === openKey;
          return (
            <li
              key={entry.key}
              className={cn(
                "overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
                selected && "ring-2 ring-[hsl(var(--e-primary)/0.4)]",
                !entry.active && "opacity-60",
              )}
            >
              {reason ? (
                <EToneBand tone="attention" className="flex items-start gap-2.5 px-3.5 py-2.5">
                  <CardHeader entry={entry} />
                  <ETonePill tone="attention">{reason}</ETonePill>
                </EToneBand>
              ) : (
                <div className="flex items-start gap-2.5 px-3.5 pt-3">
                  <CardHeader entry={entry} />
                  {entry.types.includes("LAUNDRY") ? <EPill tone="info">{TYPE_LABELS.LAUNDRY}</EPill> : null}
                </div>
              )}
              <dl className="grid grid-cols-3 gap-2 px-3.5 py-2.5 text-[0.75rem]">
                <div className="min-w-0">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">Logins</dt>
                  <dd className={cn("font-[600]", !entry.loginCount && "font-[400] text-[hsl(var(--e-muted-foreground))]")}>{entry.loginsLabel}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">In progress</dt>
                  <dd className={cn("font-[600]", !entry.progressCount && "font-[400] text-[hsl(var(--e-muted-foreground))]")}>{entry.progressLabel}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">On time</dt>
                  <dd className={cn("e-tnum font-[600]", entry.onTimePct == null && "font-[400] text-[hsl(var(--e-muted-foreground))]")}>{entry.onTimePct == null ? "–" : `${entry.onTimePct}%`}</dd>
                </div>
              </dl>
              {entry.attention.length > 1 || (entry.lateCount && entry.attention.length) ? (
                <ul className="list-disc px-3.5 pb-2 pl-8 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {entry.attention.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              <div className="flex items-center gap-2 border-t border-[hsl(var(--e-border))] px-3.5 py-2">
                <EButton size="sm" variant={selected ? "primary" : "outline"} className="flex-1" onClick={() => onOpen(entry)} aria-label={`Open ${entry.name}`}>Open</EButton>
                <ERowMenu label={`More for ${entry.name}`} items={menuFor(entry)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
