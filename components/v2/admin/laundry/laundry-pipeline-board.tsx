"use client";

/**
 * Pipeline board: search, Laundry team (route) and Laundry partner filters, "Exceptions first",
 * multi-select with a bulk "Move to…" and the four lanes. At desktop the lanes
 * sit side by side; on a phone each lane is a collapsible section with its count.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EField, ESelect } from "@/components/v2/admin/estate-kit";
import { PIPELINE_LANES, PIPELINE_LANE_LABELS, type PipelineLane } from "@/lib/laundry/pipeline";
import { LaundryLaneCard, shortDay } from "./laundry-lane-card";
import type { PipelineCardDTO, PipelineData, PipelineQuery } from "./use-laundry-pipeline";

type Props = {
  data: PipelineData | null;
  status: "loading" | "success" | "error";
  error: string;
  refreshFailed: boolean;
  query: PipelineQuery;
  onQuery: (patch: Partial<PipelineQuery>) => void;
  exceptionsFirst: boolean;
  onExceptionsFirst: (value: boolean) => void;
  openId: string | null;
  savingIds: ReadonlySet<string>;
  nextDayLabel: string;
  onOpen: (card: PipelineCardDTO) => void;
  onMove: (cards: PipelineCardDTO[]) => void;
  onMoveNextDay: (card: PipelineCardDTO) => void;
  onRetry: () => void;
};

export function orderLane(cards: PipelineCardDTO[], exceptionsFirst: boolean): PipelineCardDTO[] {
  if (!exceptionsFirst) return cards;
  return [...cards].sort((a, b) => Number(b.exceptions.length > 0) - Number(a.exceptions.length > 0));
}

function laneTitle(lane: PipelineLane, data: PipelineData | null): string {
  if (lane === "drop" && data && data.date !== data.today) return `To drop ${shortDay(`${data.date}T00:00:00.000Z`)}`;
  return PIPELINE_LANE_LABELS[lane];
}

export function LaundryPipelineBoard(props: Props) {
  const { data, status, query, onQuery, exceptionsFirst, savingIds } = props;
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const searchId = React.useId();
  // A different day or filter set starts a fresh selection.
  React.useEffect(() => setSelected(new Set()), [query.date, query.q, query.driverId, query.supplierId]);

  const allCards = data ? PIPELINE_LANES.flatMap((lane) => data.lanes[lane]) : [];
  const selectedCards = allCards.filter((card) => selected.has(card.id));
  const driverName = data?.drivers.find((driver) => driver.id === query.driverId)?.name ?? (query.driverId === "__none" ? "No route" : null);
  const supplierName = data?.suppliers.find((supplier) => supplier.id === query.supplierId)?.name ?? null;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function lane(laneKey: PipelineLane) {
    const cards = orderLane(data?.lanes[laneKey] ?? [], exceptionsFirst);
    const count = data?.counts[laneKey];
    const body = cards.length === 0 ? (
      <p className="px-1 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{status === "loading" && !data ? "Loading…" : "Nothing here."}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {cards.map((card) => (
          <LaundryLaneCard
            key={card.id}
            card={card}
            active={props.openId === card.id}
            selectable={selecting}
            selected={selected.has(card.id)}
            saving={savingIds.has(card.id)}
            moveLabel={laneKey === "pickup" || laneKey === "drop" ? props.nextDayLabel : null}
            onOpen={() => props.onOpen(card)}
            onToggle={() => toggle(card.id)}
            onMove={() => props.onMoveNextDay(card)}
            todayKey={data?.today}
          />
        ))}
      </ul>
    );
    return (
      <section key={laneKey} aria-label={laneTitle(laneKey, data)} className="min-w-0 flex-1 rounded-[12px] bg-[hsl(var(--e-surface-raised))] p-2.5">
        <details open className="group lg:pointer-events-none" >
          <summary className="flex cursor-pointer list-none items-center justify-between px-1 py-0.5 font-[600] lg:cursor-default">
            <span>{laneTitle(laneKey, data)}</span>
            <span className="e-tnum">{typeof count === "number" ? count : "—"}</span>
          </summary>
          <div className="mt-2 lg:pointer-events-auto">{body}</div>
        </details>
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={searchId} className="sr-only">Search property or supplier</label>
        <input
          id={searchId}
          type="search"
          value={query.q}
          onChange={(event) => onQuery({ q: event.target.value })}
          placeholder="Search property or supplier"
          className="h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:w-[220px] sm:text-[0.8125rem]"
        />
        <EFilterPopover label="Laundry team" value={driverName}>
          <EField label="Laundry team member on the day's route">
            <ESelect value={query.driverId} onChange={(event) => onQuery({ driverId: event.target.value })}>
              <option value="">Everyone</option>
              <option value="__none">No route yet</option>
              {data?.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
            </ESelect>
          </EField>
        </EFilterPopover>
        <EFilterPopover label="Laundry partner" value={supplierName}>
          <EField label="Laundry partner">
            <ESelect value={query.supplierId} onChange={(event) => onQuery({ supplierId: event.target.value })}>
              <option value="">All partners</option>
              {data?.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </ESelect>
          </EField>
        </EFilterPopover>
        <button type="button" aria-pressed={exceptionsFirst} onClick={() => props.onExceptionsFirst(!exceptionsFirst)} className={cn(E_CHIP_CLASS, exceptionsFirst && E_CHIP_ON_CLASS)}>
          Exceptions first
        </button>
        <span className="flex-1" />
        <label className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <input type="checkbox" className="h-4 w-4" checked={selecting} onChange={(event) => { setSelecting(event.target.checked); if (!event.target.checked) setSelected(new Set()); }} />
          Select to move or reschedule several
        </label>
      </div>

      <EBulkBar count={selectedCards.length} noun={{ one: "run", many: "runs" }} onClear={() => setSelected(new Set())} note="Each run is checked against the version shown here.">
        <EBulkButton onClick={() => props.onMove(selectedCards)}>Move to…</EBulkButton>
      </EBulkBar>

      {props.refreshFailed ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-warning))]">Could not refresh; showing the last loaded lanes.</p> : null}
      {data?.truncated ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-warning))]">More runs match than can be shown at once; narrow the search or filters.</p> : null}
      {status === "error" ? (
        <div role="alert" className="text-[0.875rem]">
          <p className="text-[hsl(var(--e-danger))]">{props.error}</p>
          <button type="button" className="underline" onClick={props.onRetry}>Retry</button>
        </div>
      ) : null}
      <div className={cn("flex flex-col gap-2.5 lg:flex-row lg:items-stretch", status === "loading" && data && "opacity-70")} aria-busy={status === "loading"}>
        {PIPELINE_LANES.map((laneKey) => lane(laneKey))}
      </div>
    </div>
  );
}
