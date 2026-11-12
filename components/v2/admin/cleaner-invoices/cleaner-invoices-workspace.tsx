"use client";

/**
 * Cleaner invoices tab ("Submitted" view): the four figures, status chips with
 * real counts, search and payee / period filters, the server-paged table with
 * one action per row plus a menu, the bulk bar and the dialogs. Rows open the
 * read-only review page. Endpoints: GET /api/admin/cleaner-invoices?paginated=1,
 * PATCH/DELETE /api/admin/cleaner-invoices/[id], POST .../[id]/xero-push,
 * POST .../bulk, GET .../export.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import type { CleanerBulkResponse, CleanerPayeeOption } from "@/lib/cleaner/invoice-admin-list-types";
import { CleanerInvoiceFilters, CleanerInvoiceStatsCards } from "./cleaner-invoice-filters";
import { CleanerRowActions, cleanerColumns, cleanerReviewHref } from "./cleaner-invoice-columns";
import { CleanerInvoiceBulkBar } from "./cleaner-invoice-bulk";
import { CleanerInvoiceDialogs } from "./cleaner-invoice-dialogs";
import { useCleanerInvoiceActions } from "./use-cleaner-invoice-actions";
import type { CleanerRow } from "./cleaner-invoice-model";
import {
  CLEANER_PAGE_SIZE,
  cleanerFilterSignature,
  cleanerListApiQuery,
  useCleanerListData,
  useCleanerListState,
  writeCleanerListState,
} from "./use-cleaner-invoice-list";

function usePayees(): CleanerPayeeOption[] {
  const [payees, setPayees] = useState<CleanerPayeeOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/cleaner-invoices?view=context", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (!controller.signal.aborted && ok && Array.isArray(body.payees)) setPayees(body.payees);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return payees;
}

export function CleanerInvoicesWorkspace({ role }: { role: string }) {
  const canApprove = role === "ADMIN";
  const [state, update] = useCleanerListState();
  const { payload, loading, error, reload } = useCleanerListData(state);
  const payees = usePayees();
  const [statsToken, setStatsToken] = useState(0);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [selected, setSelected] = useState<Map<string, CleanerRow>>(new Map());
  const signature = cleanerFilterSignature(state);
  useEffect(() => setSelected(new Map()), [signature]);

  const refresh = useCallback(() => {
    reload();
    setStatsToken((token) => token + 1);
  }, [reload]);

  // The review page's back link returns to this exact view.
  const back = `/v2/admin/finance?${writeCleanerListState(new URLSearchParams({ tab: "cleaner-invoices" }), state).toString()}`;
  const reviewHref = useCallback((row: CleanerRow) => cleanerReviewHref(row.id, back), [back]);
  const { busyId, dialog, setDialog, onAction } = useCleanerInvoiceActions(refresh, reviewHref);

  const columns = useMemo(
    () =>
      cleanerColumns({
        reviewHref,
        renderActions: (row) => (
          <CleanerRowActions row={row} role={role} busy={busyId === row.id} disabled={bulkRunning} reviewHref={reviewHref(row)} onAction={onAction} />
        ),
      }),
    [reviewHref, role, busyId, bulkRunning, onAction],
  );

  function onBulkFinished(response: CleanerBulkResponse) {
    // Done rows leave the selection; refused and unchanged stay for a retry.
    const keep = new Set(response.results.filter((row) => row.outcome !== "done").map((row) => row.id));
    setSelected((previous) => new Map(Array.from(previous).filter(([id]) => keep.has(id))));
    refresh();
  }

  const selectedRows = Array.from(selected.values());
  const unfiltered = !state.q.trim() && !state.cleaner && !state.from && !state.to;
  const nothingAtAll = Boolean(payload && unfiltered && payload.counts.all === 0);
  const exportParams = new URLSearchParams(cleanerListApiQuery(state));
  if (selectedRows.length) exportParams.set("ids", selectedRows.map((row) => row.id).join(","));

  return (
    <div className="space-y-3.5">
      <CleanerInvoiceStatsCards reloadToken={statsToken} />
      <CleanerInvoiceFilters state={state} counts={payload?.counts ?? null} payees={payees} disabled={bulkRunning} onChange={update} />
      <div className="flex justify-end">
        <EButton type="button" size="sm" variant="ghost" disabled={loading || bulkRunning} onClick={refresh}>Refresh</EButton>
      </div>
      <ECard className="overflow-hidden">
        <EDataTable
          label="Cleaner invoices"
          columns={columns}
          rows={payload?.rows ?? []}
          rowKey={(row) => row.id}
          sort={{ key: state.sort, dir: state.dir }}
          onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
          selection={{
            selected: new Set(selected.keys()),
            disabled: bulkRunning,
            rowLabel: (row) => `Select ${row.invoiceNumber ?? `${row.cleanerName}'s invoice`}`,
            onChange: (ids) => {
              const pageRows = new Map((payload?.rows ?? []).map((row) => [row.id, row]));
              setSelected((previous) => {
                const next = new Map<string, CleanerRow>();
                for (const id of Array.from(ids)) {
                  const row = pageRows.get(id) ?? previous.get(id);
                  if (row) next.set(id, row);
                }
                return next;
              });
            },
          }}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle={nothingAtAll ? "Nothing here yet" : "No invoices match"}
          emptyDescription={
            nothingAtAll
              ? "When cleaners email an invoice from their portal, it appears here for review and Xero export."
              : "Nothing matches these filters. Choose another status or clear a filter."
          }
          minWidth="62rem"
        />
        {payload && payload.total > 0 ? (
          <EPagination
            className="border-t border-[hsl(var(--e-border))] px-4 py-3"
            page={payload.page}
            pageSize={payload.pageSize ?? CLEANER_PAGE_SIZE}
            total={payload.total}
            noun="invoices"
            disabled={loading || bulkRunning}
            onPageChange={(page) => update({ page })}
          />
        ) : null}
      </ECard>
      <CleanerInvoiceBulkBar
        rows={selectedRows}
        canApprove={canApprove}
        exportHref={`/api/admin/cleaner-invoices/export?${exportParams.toString()}`}
        onClear={() => setSelected(new Map())}
        onFinished={onBulkFinished}
        onRunningChange={setBulkRunning}
      />
      <CleanerInvoiceDialogs dialog={dialog} onClose={() => setDialog(null)} onDone={refresh} />
    </div>
  );
}
