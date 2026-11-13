"use client";

/**
 * Leads and quotes as one server-paged list: stage chips with real counts,
 * search, service filter, sortable columns, one next step per row and the
 * rest in "more", bulk Send / Mark lost through one endpoint, and the side
 * panel on ?open=.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "@/hooks/use-toast";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EFilterChips, E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { cn } from "@/lib/utils";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EFilterBar, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EPagination } from "@/components/v2/ui/pagination";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { formatCurrency } from "@/lib/utils";
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS, pipelinePrimary, type PipelineRow, type PipelineSort } from "@/lib/quotes/pipeline-types";
import { MarginPill, StatusPill, prettify } from "./pipeline-format";
import { PipelineDialogs, type PipelineDialog } from "./pipeline-dialogs";
import { PipelinePanel } from "./pipeline-panel";
import { pipelineQuery, usePipeline } from "./use-pipeline";

type PipelineListProps = {
  timezone: string;
  services: Array<{ value: string; label: string }>;
  onExportHrefChange: (href: string) => void;
};

type BulkResult = { kind: string; id: string; status: "done" | "refused"; message: string };

const rowKey = (row: Pick<PipelineRow, "kind" | "id">) => `${row.kind}:${row.id}`;

function valueCell(row: PipelineRow) {
  if (row.total != null) return <span className="e-tnum">{formatCurrency(row.total)}</span>;
  if (row.estimateMin != null || row.estimateMax != null) return <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">Est. {formatCurrency(Number(row.estimateMax ?? row.estimateMin ?? 0))}</span>;
  return <span className="text-[hsl(var(--e-muted-foreground))]">–</span>;
}

export function PipelineList({ timezone, services, onExportHrefChange }: PipelineListProps) {
  const { state, update, data, loading, error, reload } = usePipeline();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<PipelineDialog | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [bulkResults, setBulkResults] = React.useState<BulkResult[] | null>(null);
  const [search, setSearch] = React.useState(state.q);

  React.useEffect(() => setSearch(state.q), [state.q]);
  const filterKey = `${state.stage}|${state.q}|${state.service}|${state.recurring}`;
  React.useEffect(() => setSelected(new Set()), [filterKey]);
  React.useEffect(() => {
    const params = pipelineQuery(state);
    params.delete("page");
    params.delete("pageSize");
    params.set("format", "csv");
    onExportHrefChange(`/api/admin/quotes/pipeline?${params.toString()}`);
  }, [state, onExportHrefChange]);

  const rows = data?.rows ?? [];
  const openRow = state.open ? rows.find((row) => rowKey(row) === state.open) ?? null : null;
  const serviceLabel = services.find((item) => item.value === state.service)?.label ?? null;
  // Phones (board M-QuotesMessages): search, service and "Recurring only" behind one Filter button.
  const activeFilters: EActiveFilter[] = [];
  if (state.q.trim()) activeFilters.push({ key: "q", label: `Search: ${state.q.trim()}`, onRemove: () => { setSearch(""); update({ q: "", page: 1 }); } });
  if (state.service) activeFilters.push({ key: "service", label: `Service: ${serviceLabel ?? state.service}`, onRemove: () => update({ service: "", page: 1 }) });
  if (state.recurring) activeFilters.push({ key: "recurring", label: "Recurring only", onRemove: () => update({ recurring: false, page: 1 }) });

  async function patchLead(row: PipelineRow, status: string, message: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leads/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not update lead.");
      toast({ title: message });
      await reload();
    } catch (err) {
      toast({ title: "Lead not updated", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function convertLead(row: PipelineRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leads/${row.id}/create-client`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not create client account.");
      toast({ title: body.warning ? "Client created with warning" : "Client account created", description: body.warning ?? "Lead converted and linked to a client profile." });
      await reload();
    } catch (err) {
      toast({ title: "Convert failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runBulk(action: "send" | "mark-lost") {
    const chosen = rows.filter((row) => selected.has(rowKey(row))).map((row) => ({ kind: row.kind, id: row.id }));
    setBusy(true);
    try {
      const res = await fetch("/api/admin/quotes/pipeline/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, rows: chosen }) });
      const body = (await res.json().catch(() => null)) as { outcomes?: BulkResult[]; error?: string } | null;
      if (!res.ok || !body?.outcomes) throw new Error(body?.error ?? "Nothing was changed.");
      setBulkResults(body.outcomes);
      setSelected(new Set(body.outcomes.filter((row) => row.status !== "done").map((row) => `${row.kind}:${row.id}`)));
      await reload();
    } catch (err) {
      toast({ title: "Bulk action failed", description: err instanceof Error ? err.message : "Nothing was changed.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function menu(row: PipelineRow): ERowMenuItem[] {
    if (row.kind === "lead") {
      return [
        { key: "view", label: "View", onSelect: () => update({ open: rowKey(row) }) },
        { key: "make", label: "Make quote", href: `/v2/admin/quotes/new?leadId=${encodeURIComponent(row.id)}` },
        { key: "counter", label: "Counter offer", onSelect: () => setDialog({ kind: "counter", row }) },
        row.clientId ? { key: "client", label: "View client", href: `/v2/admin/clients/${row.clientId}` } : { key: "convert", label: "Convert to client", onSelect: () => void convertLead(row) },
        { key: "dismiss", label: "Dismiss lead", danger: true, separated: true, disabled: row.status === "LOST", hint: row.status === "LOST" ? "Already lost" : undefined, onSelect: () => void patchLead(row, "LOST", "Lead dismissed") },
      ];
    }
    return [
      { key: "view", label: "View", onSelect: () => update({ open: rowKey(row) }) },
      { key: "open", label: "Open quote", href: `/v2/admin/quotes/${row.id}` },
      { key: "pdf", label: "Export PDF", href: `/api/admin/quotes/${row.id}/pdf`, newTab: true },
      { key: "send", label: row.status === "DRAFT" ? "Send" : "Email again", onSelect: () => setDialog({ kind: "send", row }) },
      { key: "assign", label: "Assign to client", onSelect: () => setDialog({ kind: "assign", row }) },
      { key: "delete", label: "Delete quote", danger: true, separated: true, onSelect: () => setDialog({ kind: "delete", row }) },
    ];
  }

  const columns: Array<EDataColumn<PipelineRow, PipelineSort>> = [
    {
      key: "enquiry",
      header: "Enquiry",
      sortKey: "enquiry",
      cell: (row) => (
        <div className="min-w-0">
          <button type="button" className="text-left font-[600] hover:underline" onClick={() => update({ open: rowKey(row) })}>{row.name}</button>
          <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.reference}</div>
        </div>
      ),
    },
    { key: "service", header: "Service", cell: (row) => <>{prettify(row.serviceType)}{row.frequency && row.frequency !== "one_off" ? <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{prettify(row.frequency)}</div> : null}</> },
    { key: "value", header: "Value", sortKey: "value", firstDir: "desc", align: "right", cell: valueCell },
    { key: "margin", header: "Margin", cell: (row) => (row.kind === "lead" ? <span className="text-[hsl(var(--e-muted-foreground))]">–</span> : <MarginPill row={row} />) },
    { key: "status", header: "Status", sortKey: "status", cell: (row) => <StatusPill row={row} /> },
    { key: "updated", header: "Updated", sortKey: "updated", firstDir: "desc", cell: (row) => <span className="whitespace-nowrap">{formatInTimeZone(new Date(row.updatedAt), timezone, "d MMM")}</span> },
    {
      key: "primary",
      header: <span className="sr-only">Next step</span>,
      cell: (row) => {
        const primary = pipelinePrimary(row);
        if (primary.kind === "none") return null;
        if (primary.kind === "link") return <EButton size="sm" variant={primary.label === "Make quote" ? "primary" : "outline"} asChild><Link href={primary.href}>{primary.label}</Link></EButton>;
        return (
          <EButton size="sm" variant={primary.kind === "send" ? "primary" : "outline"} disabled={busy} onClick={() => setDialog({ kind: primary.kind === "send" ? "send" : "counter", row })}>
            {primary.label}
          </EButton>
        );
      },
    },
    { key: "more", header: <span className="sr-only">More</span>, cell: (row) => <ERowMenu label={`More actions for ${row.name}`} items={menu(row)} disabled={busy} /> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <EFilterChips
            label="Stage"
            active={state.stage}
            onChange={(stage) => update({ stage, page: 1, open: null })}
            chips={PIPELINE_STAGES.map((stage) => ({ key: stage, label: PIPELINE_STAGE_LABELS[stage], count: data?.counts[stage] ?? null }))}
            phoneLayout="carousel"
            className="max-sm:w-full"
          />
          <EFilterBar
            label="Filter leads and quotes"
            className="contents"
            active={activeFilters}
            onClear={() => { setSearch(""); update({ q: "", service: "", recurring: false, page: 1 }); }}
            resultLabel={data ? `Show ${data.total} ${data.total === 1 ? "enquiry" : "enquiries"}` : undefined}
          >
          <span className="hidden flex-1 sm:block" />
          <label className="sr-only" htmlFor="quotes-search">Search quotes</label>
          <input
            id="quotes-search"
            className="h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:w-[200px] sm:text-[0.8125rem]"
            placeholder="Search name, suburb, no."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              update({ q: event.target.value, page: 1 });
            }}
          />
          <EFilterPopover label="Service" value={serviceLabel} emptyValue="all">
            <label className="block text-[0.75rem] font-[550]" htmlFor="quotes-service">Service</label>
            <select id="quotes-service" className="h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]" value={state.service} onChange={(e) => update({ service: e.target.value, page: 1 })}>
              <option value="">All services</option>
              {services.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </EFilterPopover>
          <button type="button" aria-pressed={state.recurring} className={cn(E_CHIP_CLASS, state.recurring && E_CHIP_ON_CLASS)} onClick={() => update({ recurring: !state.recurring, page: 1 })}>
            Recurring only
          </button>
          </EFilterBar>
        </div>
        <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <EDataTable
            label="Leads and quotes"
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            sort={{ key: state.sort, dir: state.dir }}
            onSortChange={(next) => update({ sort: next.key, dir: next.dir, page: 1 })}
            loading={loading}
            error={error}
            onRetry={() => void reload()}
            emptyTitle={state.q || state.service || state.recurring ? "No enquiries match" : `No ${PIPELINE_STAGE_LABELS[state.stage].toLowerCase()} enquiries`}
            emptyDescription="Requests from the public quote page and quotes made here appear in this list."
            minWidth="860px"
            onRowClick={(row) => update({ open: rowKey(row) })}
            activeRowKey={state.open}
            selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name} ${row.reference}`, disabled: busy }}
          />
          <div className="border-t border-[hsl(var(--e-border))] px-3 py-2">
            <EPagination page={state.page} pageSize={25} total={data?.total ?? 0} onPageChange={(page) => update({ page })} disabled={loading} noun="enquiries" />
          </div>
        </div>
        <EBulkBar count={selected.size} noun={{ one: "enquiry", many: "enquiries" }} onClear={() => setSelected(new Set())} busy={busy} note="Send goes to each quote's client or lead email. Mark lost applies to leads.">
          <EBulkButton onClick={() => void runBulk("send")}>Send</EBulkButton>
          <EBulkButton onClick={() => void runBulk("mark-lost")}>Mark lost</EBulkButton>
        </EBulkBar>
        {/* Phones: "New quote" docked in thumb reach while no bulk bar owns the bottom. */}
        <EPhoneActionBar
          label="Quotes actions"
          hidden={selected.size > 0}
          secondary={<EButton asChild variant="outline"><Link href="/v2/admin/cases">Repair quote from a case</Link></EButton>}
          primary={<EButton asChild><Link href="/v2/admin/quotes/new">New quote</Link></EButton>}
        />
        {bulkResults ? (
          <section aria-label="Bulk results" className="space-y-1 rounded-[10px] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
            <div className="flex items-center justify-between"><p className="font-[600]">Results</p><EButton size="sm" variant="ghost" onClick={() => setBulkResults(null)}>Dismiss</EButton></div>
            <ul aria-live="polite" className="space-y-1">
              {bulkResults.map((result) => (
                <li key={`${result.kind}:${result.id}`} className="flex flex-wrap items-center gap-2">
                  <EPill tone={result.status === "done" ? "ok" : "bad"}>{result.status === "done" ? "Done" : "Refused"}</EPill>
                  <span>{rows.find((row) => row.id === result.id)?.name ?? result.id}</span>
                  {result.status !== "done" ? <span className="text-[hsl(var(--e-muted-foreground))]">{result.message}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {openRow ? (
        <PipelinePanel
          key={state.open ?? ""}
          row={openRow}
          busy={busy}
          onClose={() => update({ open: null })}
          onSend={() => setDialog({ kind: "send", row: openRow })}
          onCounter={() => setDialog({ kind: "counter", row: openRow })}
          onLeadStatus={(status) => void patchLead(openRow, status, status === "LOST" ? "Lead dismissed" : "Lead updated")}
          onConvertLead={() => void convertLead(openRow)}
        />
      ) : null}
      <PipelineDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onDone={async (message) => {
          toast({ title: message });
          setDialog(null);
          await reload();
        }}
      />
    </div>
  );
}
