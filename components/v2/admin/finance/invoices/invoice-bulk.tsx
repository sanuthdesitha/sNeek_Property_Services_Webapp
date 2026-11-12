"use client";

/**
 * Bulk actions for selected client invoices. One request to the bulk route,
 * which runs each invoice through the single-invoice action and answers per
 * row; this component only confirms, sends that one request and shows the
 * answer. A refused row is shown as refused, with the server's reason.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EModal, ESwitch } from "@/components/v2/admin/estate-kit";
import {
  CLIENT_INVOICE_BULK_MAX_IDS,
  type ClientInvoiceBulkAction,
  type ClientInvoiceBulkResponse,
} from "@/lib/billing/client-invoice-list-types";
import { STATUS_LABEL, money, type InvoiceRow } from "./invoice-model";
import { PDF_ARCHIVE_MAX_INVOICES, downloadPdfArchive, type ArchiveOutcome } from "./pdf-archive-download";

const ACTION_COPY: Record<ClientInvoiceBulkAction, { title: string; confirm: string; body: string; needsReview: boolean }> = {
  approve: {
    title: "Approve selected invoices",
    confirm: "Approve",
    body: "Each draft is approved through the same checks as approving it on its own, including the started-work review. Anything that is not a draft is reported back unchanged or refused.",
    needsReview: false,
  },
  send: {
    title: "Send selected invoices",
    confirm: "Send",
    body: "Each invoice is emailed to its client's invoice recipients and marked Sent. Invoices already sent are refused here; use Re-send on the row.",
    needsReview: true,
  },
  "approve-and-send": {
    title: "Approve and send selected invoices",
    confirm: "Approve and send",
    body: "Two steps per invoice, in order: approve (drafts only), then send to the client's invoice recipients. If approval is refused the invoice is not sent.",
    needsReview: true,
  },
  "xero-push": {
    title: "Push selected invoices to Xero",
    confirm: "Push to Xero",
    body: "Each invoice is pushed once, with the same reservation and idempotency key as a single push. Invoices already in Xero are left alone.",
    needsReview: false,
  },
};

const OUTCOME_LABEL = { done: "Done", refused: "Refused", unchanged: "No change" } as const;

export type BulkRunState =
  | { status: "idle" }
  | { status: "running"; action: ClientInvoiceBulkAction }
  | { status: "finished"; response: ClientInvoiceBulkResponse }
  | { status: "failed"; message: string };

function selectedTotal(rows: InvoiceRow[]): number {
  // Display only: the sum of the stored totals shown on the selected rows.
  return Math.round(rows.reduce((sum, row) => sum + row.totalAmount, 0) * 100) / 100;
}

export function InvoiceBulkBar({
  selectedRows,
  exportHref,
  onClear,
  onFinished,
  onRunningChange,
  onXeroRefresh,
  xeroRefreshing = false,
}: {
  selectedRows: InvoiceRow[];
  exportHref: string;
  onClear: () => void;
  /** Called with the server's answer so the list can reload and keep refused rows selected. */
  onFinished: (response: ClientInvoiceBulkResponse) => void;
  onRunningChange: (running: boolean) => void;
  /** "Refresh from Xero" for the selection (its own endpoint, per-row outcomes). */
  onXeroRefresh?: () => void;
  xeroRefreshing?: boolean;
}) {
  const [pending, setPending] = useState<ClientInvoiceBulkAction | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [run, setRun] = useState<BulkRunState>({ status: "idle" });
  const [exportError, setExportError] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchiveOutcome | { status: "running" } | null>(null);
  const tooManyPdfs = selectedRows.length > PDF_ARCHIVE_MAX_INVOICES;
  const tooMany = selectedRows.length > CLIENT_INVOICE_BULK_MAX_IDS;
  const allDrafts = selectedRows.length > 0 && selectedRows.every((row) => row.status === "DRAFT");
  const noun = allDrafts ? { one: "draft", many: "drafts" } : { one: "invoice", many: "invoices" };

  function ask(action: ClientInvoiceBulkAction) {
    setReviewed(false);
    setPending(action);
  }

  async function confirm() {
    if (!pending) return;
    const action = pending;
    setRun({ status: "running", action });
    onRunningChange(true);
    try {
      const response = await fetch("/api/admin/invoices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedRows.map((row) => row.id) }),
      });
      const body = (await response.json().catch(() => null)) as (ClientInvoiceBulkResponse & { error?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.results)) {
        setRun({ status: "failed", message: body?.error ?? "The bulk action could not be run. Nothing is reported as done." });
        return;
      }
      setRun({ status: "finished", response: body });
      setPending(null);
      onFinished(body);
    } catch {
      setRun({ status: "failed", message: "Could not reach the server. Some invoices may have been processed; reload the list to check." });
    } finally {
      onRunningChange(false);
    }
  }

  async function exportCsv() {
    setExportError(null);
    try {
      const response = await fetch(exportHref, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setExportError(body.error ?? "The export could not be created.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `client-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("The export could not be downloaded.");
    }
  }

  async function downloadPdfs() {
    setArchive({ status: "running" });
    setArchive(await downloadPdfArchive(selectedRows.map((row) => row.id)));
  }

  const running = run.status === "running";
  const copy = pending ? ACTION_COPY[pending] : null;

  return (
    <div className="space-y-2">
      <EBulkBar
        count={selectedRows.length}
        noun={noun}
        summary={money(selectedTotal(selectedRows))}
        onClear={onClear}
        busy={running}
        note={tooMany ? `Select at most ${CLIENT_INVOICE_BULK_MAX_IDS} for approve, send or Xero.` : undefined}
      >
        <EBulkButton disabled={tooMany} onClick={() => ask("approve")}>Approve</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => ask("approve-and-send")}>Approve and send</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => ask("xero-push")}>Push to Xero</EBulkButton>
        {onXeroRefresh ? (
          <EBulkButton disabled={tooMany || xeroRefreshing} onClick={onXeroRefresh}>
            Refresh from Xero
          </EBulkButton>
        ) : null}
        <EBulkButton disabled={tooManyPdfs || archive?.status === "running"} onClick={downloadPdfs}>
          {archive?.status === "running" ? "Preparing PDFs…" : "Download PDFs"}
        </EBulkButton>
        <EBulkButton onClick={exportCsv}>Export CSV</EBulkButton>
      </EBulkBar>
      {tooManyPdfs ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Download PDFs takes at most {PDF_ARCHIVE_MAX_INVOICES} invoices at a time.</p>
      ) : null}
      <ArchiveResult outcome={archive} onDismiss={() => setArchive(null)} />
      {exportError ? (
        <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
          {exportError}
        </p>
      ) : null}
      <BulkResults run={run} onDismiss={() => setRun({ status: "idle" })} />

      {copy && pending ? (
        <EModal open onClose={() => !running && setPending(null)} eyebrow="Please confirm" title={copy.title}>
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{copy.body}</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
              {selectedRows.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono text-[0.75rem]">{row.invoiceNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{row.client.name}</span>
                  <span>{STATUS_LABEL[row.status]}</span>
                </li>
              ))}
            </ul>
            {copy.needsReview ? (
              <ESwitch
                checked={reviewed}
                onCheckedChange={setReviewed}
                disabled={running}
                label="I've reviewed these invoices and confirm they're correct to send."
              />
            ) : null}
            {run.status === "failed" ? (
              <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
                {run.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <EButton size="sm" variant="outline" disabled={running} onClick={() => setPending(null)}>
                Cancel
              </EButton>
              <EButton size="sm" disabled={running || (copy.needsReview && !reviewed)} onClick={confirm}>
                {running ? "Working…" : `${copy.confirm} ${selectedRows.length}`}
              </EButton>
            </div>
          </div>
        </EModal>
      ) : null}
    </div>
  );
}

function BulkResults({ run, onDismiss }: { run: BulkRunState; onDismiss: () => void }) {
  if (run.status !== "finished") return null;
  const { response } = run;
  return (
    <section
      role="status"
      aria-label="Bulk action results"
      className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] font-[600]">
          {response.summary.done} done · {response.summary.refused} refused · {response.summary.unchanged} no change
        </p>
        <EButton size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </EButton>
      </div>
      <ul className="space-y-1 text-[0.8125rem]">
        {response.results.map((row) => (
          <li key={row.id} className="flex flex-wrap gap-x-2">
            <span className="font-mono text-[0.75rem]">{row.invoiceNumber ?? row.id}</span>
            <span
              className={
                row.outcome === "done"
                  ? "text-[hsl(var(--e-success))]"
                  : row.outcome === "refused"
                    ? "text-[hsl(var(--e-danger))]"
                    : "text-[hsl(var(--e-muted-foreground))]"
              }
            >
              {OUTCOME_LABEL[row.outcome]}
            </span>
            {row.reason ? <span className="text-[hsl(var(--e-text-secondary))]">{row.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArchiveResult({ outcome, onDismiss }: { outcome: ArchiveOutcome | { status: "running" } | null; onDismiss: () => void }) {
  if (!outcome || outcome.status === "running") return null;
  if (outcome.status === "failed") {
    return (
      <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
        {outcome.message}{" "}
        <button type="button" className="underline" onClick={onDismiss}>
          Dismiss
        </button>
      </p>
    );
  }
  return (
    <section role="status" aria-label="PDF download" className="space-y-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.8125rem]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-[600]">
          {outcome.summary.includedCount} PDF{outcome.summary.includedCount === 1 ? "" : "s"} downloaded
          {outcome.summary.failed.length ? ` · ${outcome.summary.failed.length} could not be included (listed in _errors.txt)` : ""}
        </p>
        <EButton size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </EButton>
      </div>
      {outcome.summary.failed.length ? (
        <ul className="space-y-0.5">
          {outcome.summary.failed.map((row) => (
            <li key={row.id} className="break-words text-[hsl(var(--e-danger))]">
              <span className="font-mono text-[0.75rem]">{row.invoiceNumber ?? row.id}</span> {row.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
