"use client";

import * as React from "react";
import { fromZonedTime } from "date-fns-tz";
import { Trash2 } from "lucide-react";
import { EDataTable, type EDataColumn, type TableSort } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPill } from "@/components/v2/ui/pill";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { NOTIFICATION_TRANSPORTS, TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import { DELIVERY_STATES, DELIVERY_STATE_LABEL, type DeliveryLogRow } from "@/lib/notifications/delivery-log-map";
import { CommsDeliveryLog } from "@/components/v2/admin/comms/delivery-log";
import { NotificationIntentQueue } from "@/components/v2/admin/comms/intent-queue";
import type { EstateToast } from "@/components/v2/admin/comms/toast";
import { useNotificationRead } from "./use-notification-read";
import { formatDeliveryTime, stateTone } from "./delivery-format";
import { DeliveryDetailPanel } from "./delivery-detail-panel";
import { LazyDisclosure } from "./lazy-disclosure";

type Filters = { type: string; state: string; transport: string; recipient: string; from: string; to: string; source: string };
const EMPTY: Filters = { type: "", state: "", transport: "", recipient: "", from: "", to: "", source: "" };
type Page = { rows: DeliveryLogRow[]; total: number; page: number; pageSize: number };

function parsePage(body: unknown): Page {
  const value = body as Partial<Page> | null;
  if (!value || !Array.isArray(value.rows) || typeof value.total !== "number") throw new Error("bad page");
  return { rows: value.rows, total: value.total, page: value.page ?? 1, pageSize: value.pageSize ?? 25 };
}

/** Calendar days in the filter are organisation days (not the viewer's browser timezone). */
function buildUrl(filters: Filters, page: number, sort: TableSort<"time">, timeZone: string): string {
  const params = new URLSearchParams({ page: String(page), pageSize: "25", sort: sort.key, dir: sort.dir });
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    // Date inputs are calendar days; send the whole day as instants.
    if (key === "from") params.set(key, fromZonedTime(`${value}T00:00:00`, timeZone).toISOString());
    else if (key === "to") params.set(key, fromZonedTime(`${value}T23:59:59.999`, timeZone).toISOString());
    else params.set(key, value);
  }
  return `/api/admin/notifications/deliveries?${params.toString()}`;
}

export function DeliveryLogTab({ readOnly, onToast, timeZone }: { readOnly: boolean; onToast: (toast: EstateToast) => void; timeZone?: string }) {
  const [draft, setDraft] = React.useState<Filters>(EMPTY);
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<TableSort<"time">>({ key: "time", dir: "desc" });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const read = useNotificationRead(buildUrl(filters, page, sort, timeZone ?? "Australia/Sydney"), parsePage, "Could not load the delivery log.");
  const open = read.data?.rows.find((row) => row.id === openId) ?? null;

  function apply(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }

  async function clearAll() {
    setClearing(true);
    const response = await fetch("/api/admin/notifications/log", { method: "DELETE" }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setClearing(false);
    if (!response?.ok) {
      onToast({ title: "Clear failed", description: body?.error ?? "Could not clear notification log.", tone: "danger" });
      return;
    }
    onToast({ title: "Notification log cleared", tone: "success" });
    setClearOpen(false);
    read.reload();
  }

  const columns: Array<EDataColumn<DeliveryLogRow, "time">> = [
    { key: "time", header: "Time", sortKey: "time", firstDir: "desc", cell: (row) => <span className="whitespace-nowrap text-xs">{formatDeliveryTime(row.time, timeZone)}</span> },
    { key: "type", header: "Type", className: "max-w-[14rem]", cell: (row) => (
      <button type="button" className="text-left text-xs font-medium underline-offset-2 hover:underline" onClick={() => setOpenId(row.id)}>
        {row.typeName}<span className="block font-normal text-[hsl(var(--e-muted-foreground))]">{row.subject}</span>
      </button>
    ) },
    { key: "recipient", header: "Recipient", className: "max-w-[12rem]", cell: (row) => <span className="text-xs [overflow-wrap:anywhere]">{row.recipientLabel}</span> },
    { key: "transport", header: "Transport", cell: (row) => <span className="text-xs">{TRANSPORT_LABEL[row.transport]}{row.phonePush ? ` · phone push ${row.phonePush}` : ""}<span className="block text-[hsl(var(--e-muted-foreground))]">{row.path}</span></span> },
    { key: "state", header: "State", cell: (row) => <EPill tone={stateTone(row.state)}>{row.stateLabel}</EPill> },
    { key: "error", header: "Error", className: "max-w-[10rem]", cell: (row) => <span className="text-xs [overflow-wrap:anywhere]">{row.error ?? ""}</span> },
    { key: "related", header: "Record", cell: (row) => (row.related ? <a className="text-xs underline" href={row.related.href}>{row.related.label}</a> : null) },
  ];

  return (
    <section aria-labelledby="delivery-log-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="delivery-log-heading" className="text-lg font-semibold">Delivery log</h2>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Pipeline and direct sends in one list. Accepted by a provider is not proof that a person received it.</p>
        </div>
        <EButton variant="danger" size="sm" onClick={() => setClearOpen(true)}><Trash2 className="h-4 w-4" />Clear log</EButton>
      </div>

      <form onSubmit={apply} className="grid gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 sm:grid-cols-2 lg:grid-cols-4">
        <EField label="Type">
          <ESelect value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
            <option value="">All types</option>
            {NOTIFICATION_CATALOG.map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
          </ESelect>
        </EField>
        <EField label="State">
          <ESelect value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value })}>
            <option value="">All states</option>
            {DELIVERY_STATES.map((state) => <option key={state} value={state}>{DELIVERY_STATE_LABEL[state]}</option>)}
          </ESelect>
        </EField>
        <EField label="Transport">
          <ESelect value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value })}>
            <option value="">All transports</option>
            {NOTIFICATION_TRANSPORTS.map((transport) => <option key={transport} value={transport}>{TRANSPORT_LABEL[transport]}</option>)}
          </ESelect>
        </EField>
        <EField label="Recipient">
          <EInput value={draft.recipient} onChange={(event) => setDraft({ ...draft, recipient: event.target.value })} placeholder="Name or email" />
        </EField>
        <EField label="From"><EInput type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></EField>
        <EField label="To"><EInput type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></EField>
        <EField label="Source">
          <ESelect value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
            <option value="">All sources</option>
            <option value="intent">Pipeline</option>
            <option value="notification">Direct and inbox records</option>
            <option value="template_log">Template and provider events</option>
          </ESelect>
        </EField>
        <div className="flex items-end gap-2">
          <EButton type="submit" size="sm">Apply filters</EButton>
          <EButton type="button" size="sm" variant="ghost" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); }}>Clear</EButton>
        </div>
      </form>

      {read.error && read.data ? <EAlert tone="warning" title="Showing the last loaded page">{read.error}</EAlert> : null}
      <EDataTable
        label="Delivery log"
        columns={columns}
        rows={read.data?.rows ?? []}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        loading={read.loading}
        error={read.error}
        onRetry={read.reload}
        emptyTitle="No deliveries match these filters"
        onRowClick={(row) => setOpenId(row.id)}
        activeRowKey={openId}
        minWidth="64rem"
      />
      <EPagination page={page} pageSize={25} total={read.data?.total ?? 0} onPageChange={setPage} disabled={read.loading} noun="deliveries" />

      {open ? <DeliveryDetailPanel key={open.id} row={open} readOnly={readOnly} timeZone={timeZone} onClose={() => setOpenId(null)} onChanged={read.reload} /> : null}

      <LazyDisclosure summary="Review queue: failed or uncertain pipeline deliveries">
        <NotificationIntentQueue />
      </LazyDisclosure>
      <LazyDisclosure summary="Classic log (notification records and audited admin actions)">
        <CommsDeliveryLog onToast={onToast} reloadSignal={0} />
      </LazyDisclosure>

      <EConfirmModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear notifications"
        description="This will remove all notification logs from the system, including everyone's inbox history. Pipeline intents are kept."
        confirmLabel="Clear logs"
        loading={clearing}
        onConfirm={clearAll}
      />
    </section>
  );
}
