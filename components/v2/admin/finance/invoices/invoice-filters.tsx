"use client";

/**
 * Status chips (with real counts) on the left; search and the Client, Period
 * and Xero state filters on the right. Every value lives in the URL.
 */
import { useEffect, useId, useState } from "react";
import { EFilterChips, type EFilterChip } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect, E_LABEL_CLASS } from "@/components/v2/admin/estate-kit";
import type {
  ClientInvoiceCounts,
  ClientInvoiceStatusFilter,
  ClientInvoiceXeroFilter,
} from "@/lib/billing/client-invoice-list-types";
import { XERO_LABEL, fmtDay, type InvoiceClient } from "./invoice-model";
import type { InvoiceListState } from "./use-invoice-list";

const SEARCH_DELAY_MS = 300;

const XERO_FILTER_LABEL: Record<ClientInvoiceXeroFilter, string> = {
  any: "Any",
  none: XERO_LABEL.NONE,
  pushed: XERO_LABEL.PUSHED,
  pending: "Push pending or failed",
  "in-xero": "In Xero, checked",
  "paid-in-xero": "Paid in Xero (recorded)",
  "needs-review": "Needs review",
  unknown: "State unknown",
};

export function statusChips(counts: ClientInvoiceCounts | null): Array<EFilterChip<ClientInvoiceStatusFilter>> {
  return [
    { key: "needs-action", label: "Needs action", count: counts?.needsAction },
    { key: "DRAFT", label: "Draft", count: counts?.byStatus.DRAFT },
    { key: "APPROVED", label: "Approved", count: counts?.byStatus.APPROVED },
    { key: "SENT", label: "Sent", count: counts?.byStatus.SENT },
    { key: "overdue", label: "Overdue", count: counts?.overdue },
    { key: "PART_PAID", label: "Part paid", count: counts?.byStatus.PART_PAID },
    { key: "PAID", label: "Paid", count: counts?.byStatus.PAID },
    { key: "VOID", label: "Void", count: counts?.byStatus.VOID },
    { key: "all", label: "All", count: counts?.all },
  ];
}

export function InvoiceFilters({
  state,
  counts,
  clients,
  disabled,
  onChange,
}: {
  state: InvoiceListState;
  counts: ClientInvoiceCounts | null;
  clients: InvoiceClient[];
  disabled: boolean;
  onChange: (patch: Partial<InvoiceListState>) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState(state.q);

  // Follow the URL when it changes underneath (back/forward, a link).
  useEffect(() => setSearch(state.q), [state.q]);

  // Commit typing after a pause so each keystroke is not a request.
  useEffect(() => {
    if (search === state.q) return;
    const timer = window.setTimeout(() => onChange({ q: search }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, state.q, onChange]);

  const clientName = clients.find((client) => client.id === state.client)?.name ?? (state.client ? "Selected client" : null);
  const periodValue = state.from || state.to ? `${state.from ? fmtDay(state.from) : "…"} – ${state.to ? fmtDay(state.to) : "…"}` : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <EFilterChips
        label="Invoice status"
        chips={statusChips(counts)}
        active={state.status}
        onChange={(status) => onChange({ status })}
        disabled={disabled}
      />
      <span className="hidden min-w-0 flex-1 lg:block" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search invoices
        </label>
        <EInput
          id={`${id}-search`}
          type="search"
          className="h-[34px] w-full text-[1rem] sm:w-[200px] sm:text-[0.8125rem]"
          placeholder="Search no., client"
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
        <EFilterPopover label="Client" value={clientName} disabled={disabled}>
          <label htmlFor={`${id}-client`} className={E_LABEL_CLASS}>
            Client
          </label>
          <ESelect id={`${id}-client`} value={state.client} onChange={(event) => onChange({ client: event.target.value })}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </ESelect>
        </EFilterPopover>
        <EFilterPopover label="Period" value={periodValue} disabled={disabled}>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Invoices whose service period starts in this range.</p>
          <label htmlFor={`${id}-from`} className={E_LABEL_CLASS}>
            Starts on or after
          </label>
          <EInput id={`${id}-from`} type="date" value={state.from} max={state.to || undefined} onChange={(event) => onChange({ from: event.target.value })} />
          <label htmlFor={`${id}-to`} className={E_LABEL_CLASS}>
            Starts on or before
          </label>
          <EInput id={`${id}-to`} type="date" value={state.to} min={state.from || undefined} onChange={(event) => onChange({ to: event.target.value })} />
          {periodValue ? (
            <EButton size="sm" variant="ghost" onClick={() => onChange({ from: "", to: "" })}>
              Clear period
            </EButton>
          ) : null}
        </EFilterPopover>
        <EFilterPopover label="Xero state" value={state.xero === "any" ? null : XERO_FILTER_LABEL[state.xero]} disabled={disabled}>
          <label htmlFor={`${id}-xero`} className={E_LABEL_CLASS}>
            Xero state
          </label>
          <ESelect id={`${id}-xero`} value={state.xero} onChange={(event) => onChange({ xero: event.target.value as ClientInvoiceXeroFilter })}>
            {(Object.keys(XERO_FILTER_LABEL) as ClientInvoiceXeroFilter[]).map((key) => (
              <option key={key} value={key}>
                {XERO_FILTER_LABEL[key]}
              </option>
            ))}
          </ESelect>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            A failed push stays pending until it is retried, so the two cannot be told apart. The last four come from the hourly
            check against Xero.
          </p>
        </EFilterPopover>
      </div>
    </div>
  );
}
