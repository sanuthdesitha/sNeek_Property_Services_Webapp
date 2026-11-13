"use client";

/**
 * The filter row as drawn: search, the attention chips with real counts,
 * Client and Suburb, then "Show one-off sites" and the List / Cards / Map
 * switch. A chip is a toggle: pressing the active chip clears it.
 */
import { EInput, ESelect, EField } from "@/components/v2/admin/estate-kit";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EFilterBar, useInFilterSheet, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { cn } from "@/lib/utils";
import {
  PORTFOLIO_CHIPS,
  PORTFOLIO_CHIP_LABEL,
  PORTFOLIO_VIEWS,
  type PortfolioListResponse,
  type PortfolioViewMode,
} from "@/lib/properties/portfolio-options";
import type { PortfolioView } from "./portfolio-view";

const VIEW_LABEL: Record<PortfolioViewMode, string> = { list: "List", cards: "Cards", map: "Map" };

function ToggleChip({ pressed, onClick, children, disabled }: { pressed: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS)}>
      {children}
    </button>
  );
}

export function PortfolioFilters({
  view,
  data,
  onChange,
  disabled = false,
}: {
  view: PortfolioView;
  data: PortfolioListResponse | null;
  onChange: (patch: Partial<PortfolioView>) => void;
  disabled?: boolean;
}) {
  const clients = data?.facets.clients ?? [];
  const suburbs = data?.facets.suburbs ?? [];
  const clientName = clients.find((client) => client.id === view.clientId)?.name ?? (view.clientId ? "Selected" : null);

  // Phones (board M-Properties): the same controls behind one Filter button,
  // active ones as removable chips; the List / Cards / Map switch stays visible.
  const active: EActiveFilter[] = [];
  if (view.q.trim()) active.push({ key: "q", label: `Search: ${view.q.trim()}`, onRemove: () => onChange({ q: "" }) });
  if (view.chip) active.push({ key: "chip", label: PORTFOLIO_CHIP_LABEL[view.chip], onRemove: () => onChange({ chip: null }) });
  if (view.clientId) active.push({ key: "client", label: `Client: ${clientName ?? "Selected"}`, onRemove: () => onChange({ clientId: "" }) });
  if (view.suburb) active.push({ key: "suburb", label: `Suburb: ${view.suburb}`, onRemove: () => onChange({ suburb: "" }) });
  if (view.includeOneOff) active.push({ key: "oneOff", label: "One-off sites shown", onRemove: () => onChange({ includeOneOff: false }) });
  const clear = () => onChange({ q: "", chip: null, clientId: "", suburb: "", includeOneOff: false });
  const total = data?.total;

  return (
    <EFilterBar
      label="Filter properties"
      className="gap-1.5"
      active={active}
      onClear={clear}
      resultLabel={typeof total === "number" ? `Show ${total.toLocaleString("en-AU")} ${total === 1 ? "property" : "properties"}` : undefined}
      tools={<ViewSwitch mode={view.mode} onChange={(mode) => onChange({ mode })} />}
    >
      <EInput
        className="w-full sm:w-[240px]"
        aria-label="Search properties"
        placeholder="Search name, suburb, address or client"
        value={view.q}
        onChange={(event) => onChange({ q: event.target.value })}
      />
      <AttentionLabel />
      <div role="group" aria-label="Attention filters" className="flex flex-wrap items-center gap-1.5">
        {PORTFOLIO_CHIPS.map((chip) => (
          <ToggleChip key={chip} pressed={view.chip === chip} disabled={disabled} onClick={() => onChange({ chip: view.chip === chip ? null : chip })}>
            {PORTFOLIO_CHIP_LABEL[chip]}
            {data ? <span className="e-tnum">{data.counts[chip]}</span> : null}
          </ToggleChip>
        ))}
      </div>
      <EFilterPopover label="Client" value={clientName} disabled={disabled}>
        <EField label="Client">
          <ESelect value={view.clientId} onChange={(event) => onChange({ clientId: event.target.value })}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </ESelect>
        </EField>
      </EFilterPopover>
      <EFilterPopover label="Suburb" value={view.suburb || null} disabled={disabled}>
        <EField label="Suburb">
          <ESelect value={view.suburb} onChange={(event) => onChange({ suburb: event.target.value })}>
            <option value="">All suburbs</option>
            {suburbs.map((suburb) => (
              <option key={suburb} value={suburb}>{suburb}</option>
            ))}
          </ESelect>
        </EField>
      </EFilterPopover>
      <span className="hidden min-w-0 flex-1 sm:block" />
      <ToggleChip pressed={view.includeOneOff} disabled={disabled} onClick={() => onChange({ includeOneOff: !view.includeOneOff })}>
        Show one-off sites
        {data ? <span className="e-tnum">{data.counts.oneOff}</span> : null}
      </ToggleChip>
    </EFilterBar>
  );
}

function ViewSwitch({ mode, onChange }: { mode: PortfolioViewMode; onChange: (mode: PortfolioViewMode) => void }) {
  return (
    <div role="group" aria-label="View" className="flex items-center gap-1.5">
      {PORTFOLIO_VIEWS.map((option) => (
        <ToggleChip key={option} pressed={mode === option} onClick={() => onChange(option)}>
          {VIEW_LABEL[option]}
        </ToggleChip>
      ))}
    </div>
  );
}

/** In the phone filter sheet only: names the attention chips. */
function AttentionLabel() {
  return useInFilterSheet() ? <p className="basis-full text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Attention</p> : null;
}
