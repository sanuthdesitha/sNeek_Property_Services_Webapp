"use client";

/**
 * Client invoices tab: figures, status chips and filters, the paged table with
 * one action per row, the bulk bar, and the dialogs each action opens.
 *
 * Phones (below 640px, board "Admin phone: Invoices and pay"): the table's own
 * stacked cards (number, client, period, due, total, owing, status, Xero, the
 * next step and ⋯), filters behind "Filter", and "New invoice" docked at the
 * bottom (hidden while the bulk bar is up) opening a chooser sheet.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { NewInvoiceSheet } from "./new-invoice-sheet";
import { newInvoicePath } from "./new-invoice/new-invoice-format";
import type { ClientInvoiceBulkResponse } from "@/lib/billing/client-invoice-list-types";
import { InvoiceStats } from "./invoice-stats";
import { InvoiceFilters } from "./invoice-filters";
import { invoiceColumns } from "./invoice-columns";
import { InvoiceRowActions } from "./invoice-row-actions";
import { InvoiceBulkBar } from "./invoice-bulk";
import { XeroRefreshResults, useListXeroRefresh } from "./invoice-xero-refresh";
import { InvoiceDialogs, type InvoiceDialog } from "./invoice-dialogs";
import type { InvoiceActionKey, InvoiceFormContext, InvoiceRow } from "./invoice-model";
import { isDirectInvoiceAction, runDirectInvoiceAction } from "./invoice-direct-actions";
import { invoiceEditorHref } from "./invoice-links";
import { VOID_CREDIT_REFUSAL } from "./invoice-requests";
import {
  filterSignature,
  listApiQuery,
  useInvoiceListData,
  useInvoiceListState,
  writeListState,
  INVOICE_PAGE_SIZE,
} from "./use-invoice-list";

/** Old links to the "New invoice" dialogs (?new=jobs|blank|credit) now open the New invoice panel. */
const NEW_INVOICE_PARAM = "new";

function useFormContext(): InvoiceFormContext | null {
  const [context, setContext] = useState<InvoiceFormContext | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/invoices?view=context", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (controller.signal.aborted || !ok) return;
        setContext({ clients: Array.isArray(body.clients) ? body.clients : [], properties: Array.isArray(body.properties) ? body.properties : [] });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return context;
}

export function InvoiceList() {
  const router = useRouter();
  const [state, update] = useInvoiceListState();
  const { payload, loading, error, reload } = useInvoiceListData(state);
  const context = useFormContext();
  const [dialog, setDialog] = useState<InvoiceDialog>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [statsToken, setStatsToken] = useState(0);
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  // Selection survives paging but not a change of filters or sort.
  const [selected, setSelected] = useState<Map<string, InvoiceRow>>(new Map());
  const signature = filterSignature(state);
  useEffect(() => setSelected(new Map()), [signature]);

  // Keep selected snapshots current when their rows come back fresh.
  useEffect(() => {
    if (!payload) return;
    setSelected((previous) => {
      if (previous.size === 0) return previous;
      const next = new Map(previous);
      for (const row of payload.rows) if (next.has(row.id)) next.set(row.id, row);
      return next;
    });
  }, [payload]);

  const refresh = useCallback(() => {
    reload();
    setStatsToken((token) => token + 1);
  }, [reload]);
  const xero = useListXeroRefresh(refresh);

  // Old "New invoice → …" links (?new=jobs, ?new=blank or ?new=credit) open the New invoice panel.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const requested = new URLSearchParams(window.location.search).get(NEW_INVOICE_PARAM);
    if (requested !== "jobs" && requested !== "blank" && requested !== "credit") return;
    router.replace(newInvoicePath(requested));
  }, [router]);

  const runDirect = useCallback(
    async (invoice: InvoiceRow, work: () => Promise<void>) => {
      setBusyId(invoice.id);
      try {
        await work();
      } catch {
        toast({ title: "Could not reach the server", variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  // The editor page remembers this view so its back link returns here.
  const listQuery = writeListState(new URLSearchParams(), state).toString();
  const editHref = useCallback((invoice: InvoiceRow) => invoiceEditorHref(invoice.id, listQuery), [listQuery]);

  const onAction = useCallback(
    (key: InvoiceActionKey, invoice: InvoiceRow) => {
      if (isDirectInvoiceAction(key)) {
        void runDirect(invoice, async () => {
          const outcome = await runDirectInvoiceAction(key, invoice.id);
          toast({ title: outcome.title, description: outcome.description, variant: outcome.ok ? undefined : "destructive" });
          if (outcome.ok) refresh();
        });
        return;
      }
      switch (key) {
        case "edit":
          router.push(editHref(invoice));
          return;
        case "send":
        case "resend":
          setDialog({ kind: "send", invoice, resend: key === "resend" });
          return;
        case "mark-sent":
        case "record-payment":
        case "mark-paid":
        case "receipt":
        case "void":
        case "reverse":
        case "reconcile":
        case "delete":
        case "credit-note":
          setDialog({ kind: key, invoice });
          return;
        default:
          return;
      }
    },
    [refresh, runDirect, router, editHref],
  );

  const columns = useMemo(
    () =>
      invoiceColumns({
        today: payload?.today ?? new Date().toISOString().slice(0, 10),
        termsDays: payload?.paymentTermsDays ?? 14,
        invoiceHref: editHref,
        renderActions: (invoice) => (
          <InvoiceRowActions
            invoice={invoice}
            busy={busyId === invoice.id}
            disabled={bulkRunning}
            editHref={editHref(invoice)}
            voidCreditRefusal={payload?.canVoidCredit === false ? VOID_CREDIT_REFUSAL : null}
            onAction={onAction}
          />
        ),
      }),
    [payload?.today, payload?.paymentTermsDays, payload?.canVoidCredit, busyId, bulkRunning, onAction, editHref],
  );

  function onBulkFinished(response: ClientInvoiceBulkResponse) {
    // Done rows leave the selection; refused and unchanged stay for a retry.
    const keep = new Set(response.results.filter((row) => row.outcome !== "done").map((row) => row.id));
    setSelected((previous) => new Map(Array.from(previous).filter(([id]) => keep.has(id))));
    refresh();
  }

  const selectedRows = Array.from(selected.values());
  const pageXeroIds = (payload?.rows ?? []).filter((row) => row.xeroInvoiceId).map((row) => row.id);
  const exportParams = new URLSearchParams(listApiQuery(state));
  if (selectedRows.length) exportParams.set("ids", selectedRows.map((row) => row.id).join(","));

  return (
    <div className="space-y-3.5">
      <InvoiceStats reloadToken={statsToken} canCreate onCreateDrafts={() => setDialog({ kind: "batch-drafts" })} />
      <InvoiceFilters
        state={state}
        counts={payload?.counts ?? null}
        clients={context?.clients ?? []}
        disabled={bulkRunning}
        total={payload?.total ?? null}
        onChange={update}
      />
      {/* The old screen's "Refresh": re-reads the page of rows and the figures.
          "Refresh from Xero" checks this page's invoices that are in Xero. */}
      <div className="flex flex-wrap justify-end gap-2">
        <EButton
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading || bulkRunning || xero.run.status === "running" || pageXeroIds.length === 0}
          onClick={() => void xero.refresh(pageXeroIds)}
          title={pageXeroIds.length ? undefined : "No invoice on this page is in Xero."}
        >
          Refresh from Xero
        </EButton>
        <EButton type="button" size="sm" variant="ghost" disabled={loading || bulkRunning} onClick={refresh}>
          Refresh
        </EButton>
      </div>
      <XeroRefreshResults run={xero.run} onDismiss={xero.dismiss} />
      <ECard {...tourTarget("admin.finance.invoices.list")} className="overflow-hidden">
        <EDataTable
          label="Client invoices"
          columns={columns}
          rows={payload?.rows ?? []}
          rowKey={(row) => row.id}
          sort={{ key: state.sort, dir: state.dir }}
          onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
          selection={{
            selected: new Set(selected.keys()),
            disabled: bulkRunning,
            rowLabel: (row) => `Select ${row.invoiceNumber}`,
            onChange: (ids) => {
              const pageRows = new Map((payload?.rows ?? []).map((row) => [row.id, row]));
              setSelected((previous) => {
                const next = new Map<string, InvoiceRow>();
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
          emptyTitle="No invoices here"
          emptyDescription="Nothing matches these filters. Choose another status or clear a filter."
          minWidth="60rem"
        />
        {payload && payload.total > 0 ? (
          <EPagination
            className="border-t border-[hsl(var(--e-border))] px-4 py-3"
            page={payload.page}
            pageSize={payload.pageSize ?? INVOICE_PAGE_SIZE}
            total={payload.total}
            noun="invoices"
            disabled={loading || bulkRunning}
            onPageChange={(page) => update({ page })}
          />
        ) : null}
      </ECard>
      <InvoiceBulkBar
        selectedRows={selectedRows}
        exportHref={`/api/admin/invoices/export?${exportParams.toString()}`}
        onClear={() => setSelected(new Map())}
        onFinished={onBulkFinished}
        onRunningChange={setBulkRunning}
        onXeroRefresh={() => void xero.refresh(selectedRows.map((row) => row.id))}
        xeroRefreshing={xero.run.status === "running"}
      />
      <InvoiceDialogs dialog={dialog} context={context} onClose={() => setDialog(null)} onDone={refresh} />
      <EPhoneActionBar
        label="Client invoice actions"
        hidden={selected.size > 0}
        primary={<EButton type="button" onClick={() => setNewSheetOpen(true)} aria-haspopup="dialog">New invoice</EButton>}
      />
      <NewInvoiceSheet
        open={newSheetOpen}
        onOpenChange={setNewSheetOpen}
        creditRefusal={payload?.canVoidCredit === false ? VOID_CREDIT_REFUSAL : null}
        onContinue={(choice) => router.push(newInvoicePath(choice))}
      />
    </div>
  );
}
