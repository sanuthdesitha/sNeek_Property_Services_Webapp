"use client";

/**
 * Status chips with real counts, search, and the payee and period filters for
 * the cleaner-invoice table; plus the four stat cards. Values live in the URL.
 */
import { useEffect, useId, useState } from "react";
import { EFilterChips, type EFilterChip } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ESelect, E_LABEL_CLASS } from "@/components/v2/admin/estate-kit";
import type {
  CleanerInvoiceCounts,
  CleanerInvoiceStats,
  CleanerInvoiceStatusFilter,
  CleanerPayeeOption,
} from "@/lib/cleaner/invoice-admin-list-types";
import { fmtDay, money } from "./cleaner-invoice-model";
import type { CleanerListState } from "./use-cleaner-invoice-list";

const SEARCH_DELAY_MS = 300;

export function cleanerStatusChips(counts: CleanerInvoiceCounts | null): Array<EFilterChip<CleanerInvoiceStatusFilter>> {
  const by = (status: string) => (counts ? counts.byStatus[status] ?? 0 : undefined);
  return [
    { key: "needs-action", label: "Needs action", count: counts?.needsAction },
    { key: "SUBMITTED", label: "Submitted", count: by("SUBMITTED") },
    { key: "APPROVED", label: "Approved", count: by("APPROVED") },
    { key: "CHANGES_REQUESTED", label: "Changes requested", count: by("CHANGES_REQUESTED") },
    { key: "XERO_PUSHED", label: "In Xero", count: by("XERO_PUSHED") },
    { key: "PAID_CLAIMED", label: "Payment claimed", count: by("PAID_CLAIMED") },
    { key: "PAID", label: "Paid", count: by("PAID") },
    { key: "VOID", label: "Reversed", count: by("VOID") },
    { key: "all", label: "All", count: counts?.all },
  ];
}

export function CleanerInvoiceFilters({
  state,
  counts,
  payees,
  disabled,
  onChange,
}: {
  state: CleanerListState;
  counts: CleanerInvoiceCounts | null;
  payees: CleanerPayeeOption[];
  disabled: boolean;
  onChange: (patch: Partial<CleanerListState>) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState(state.q);
  useEffect(() => setSearch(state.q), [state.q]);
  useEffect(() => {
    if (search === state.q) return;
    const timer = window.setTimeout(() => onChange({ q: search }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, state.q, onChange]);

  const payeeName = payees.find((payee) => payee.id === state.cleaner)?.name ?? (state.cleaner ? "Selected payee" : null);
  const fromLabel = state.from ? fmtDay(`${state.from}T12:00:00Z`) : "…";
  const toLabel = state.to ? fmtDay(`${state.to}T12:00:00Z`) : "…";
  const periodValue = state.from || state.to ? `${fromLabel} – ${toLabel}` : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <EFilterChips label="Cleaner invoice status" chips={cleanerStatusChips(counts)} active={state.status} onChange={(status) => onChange({ status })} disabled={disabled} />
      <span className="hidden min-w-0 flex-1 lg:block" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={`${id}-search`} className="sr-only">Search cleaner invoices</label>
        <EInput
          id={`${id}-search`}
          type="search"
          className="h-[34px] w-full text-[1rem] sm:w-[200px] sm:text-[0.8125rem]"
          placeholder="Invoice number or name"
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
        <EFilterPopover label="Cleaner" value={payeeName} disabled={disabled}>
          <label htmlFor={`${id}-payee`} className={E_LABEL_CLASS}>Cleaner or inspector</label>
          <ESelect id={`${id}-payee`} value={state.cleaner} onChange={(event) => onChange({ cleaner: event.target.value })}>
            <option value="">Everyone</option>
            {payees.map((payee) => (
              <option key={payee.id} value={payee.id}>
                {payee.name}{payee.role === "QA_INSPECTOR" ? " (QA inspector)" : ""}
              </option>
            ))}
          </ESelect>
        </EFilterPopover>
        <EFilterPopover label="Period" value={periodValue} disabled={disabled}>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Invoices whose period starts in this range (Sydney days).</p>
          <label htmlFor={`${id}-from`} className={E_LABEL_CLASS}>Starts on or after</label>
          <EInput id={`${id}-from`} type="date" value={state.from} max={state.to || undefined} onChange={(event) => onChange({ from: event.target.value })} />
          <label htmlFor={`${id}-to`} className={E_LABEL_CLASS}>Starts on or before</label>
          <EInput id={`${id}-to`} type="date" value={state.to} min={state.from || undefined} onChange={(event) => onChange({ to: event.target.value })} />
          {periodValue ? <EButton size="sm" variant="ghost" onClick={() => onChange({ from: "", to: "" })}>Clear period</EButton> : null}
        </EFilterPopover>
      </div>
    </div>
  );
}

type StatsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: CleanerInvoiceStats };

function Stat({ label, value, caption }: { label: string; value: React.ReactNode; caption: string }) {
  return (
    <ECard className="min-w-0 flex-1 px-4 py-3.5">
      <EEyebrow>{label}</EEyebrow>
      <span className="mt-1.5 block e-numeral text-[1.75rem] leading-none">{value}</span>
      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{caption}</p>
    </ECard>
  );
}

/** The four stat cards: stored totals over every payee invoice. A failed read says so, never zeros. */
export function CleanerInvoiceStatsCards({ reloadToken }: { reloadToken: number }) {
  const [state, setState] = useState<StatsState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/cleaner-invoices?view=stats", { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (CleanerInvoiceStats & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || typeof body.awaitingAction !== "number") {
          setState({ status: "error", message: body?.error ?? "Cleaner invoice figures could not be loaded." });
          return;
        }
        setState({ status: "ready", stats: body });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: "Cleaner invoice figures could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [reloadToken]);

  if (state.status === "loading") return <p role="status" className="sr-only">Loading cleaner invoice figures…</p>;
  if (state.status === "error") {
    return <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">{state.message}</p>;
  }
  const { stats } = state;
  return (
    <section aria-label="Cleaner invoice figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Awaiting action" value={stats.awaitingAction} caption="Submitted, approved, payment claimed, delivery review or export pending" />
      <Stat label="Awaiting value" value={money(stats.awaitingValue)} caption="Submitted and approved, not yet in Xero or paid" />
      <Stat label="In Xero" value={stats.inXero} caption="Pushed as a draft bill, not yet recorded paid" />
      <Stat label="Paid" value={stats.paid} caption="Payment recorded here" />
    </section>
  );
}
