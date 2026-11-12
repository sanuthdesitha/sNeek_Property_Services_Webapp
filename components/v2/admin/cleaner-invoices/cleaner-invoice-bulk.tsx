"use client";

/**
 * Bulk actions for selected cleaner invoices: Approve (administrators only),
 * Push to Xero and Export CSV. Approve and Push go through ONE request to the
 * bulk route, which runs each row through its single-row action and answers
 * per row. Record payment is not offered: each payment needs its own method,
 * amount and bank account, so there is no bulk-safe path.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EModal } from "@/components/v2/admin/estate-kit";
import {
  CLEANER_INVOICE_BULK_MAX_IDS,
  type CleanerBulkResponse,
  type CleanerInvoiceBulkAction,
} from "@/lib/cleaner/invoice-admin-list-types";
import { STATUS_LABEL, money, type CleanerRow } from "./cleaner-invoice-model";

const COPY: Record<CleanerInvoiceBulkAction, { title: string; body: string; confirm: string }> = {
  approve: {
    title: "Approve selected invoices",
    body: "Each submitted invoice is approved through the same check as approving it on its own. Anything else is reported back refused or unchanged.",
    confirm: "Approve",
  },
  "xero-push": {
    title: "Push selected invoices to Xero",
    body: "Each approved invoice is pushed once as a draft bill, with the same idempotency key as a single push. Invoices already in Xero are left alone; unapproved ones are refused.",
    confirm: "Push to Xero",
  },
};

type Run = { status: "idle" } | { status: "running" } | { status: "finished"; response: CleanerBulkResponse } | { status: "failed"; message: string };

export function CleanerInvoiceBulkBar({
  rows,
  canApprove,
  exportHref,
  onClear,
  onFinished,
  onRunningChange,
}: {
  rows: CleanerRow[];
  canApprove: boolean;
  exportHref: string;
  onClear: () => void;
  onFinished: (response: CleanerBulkResponse) => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [pending, setPending] = useState<CleanerInvoiceBulkAction | null>(null);
  const [run, setRun] = useState<Run>({ status: "idle" });
  const [exportError, setExportError] = useState<string | null>(null);
  const tooMany = rows.length > CLEANER_INVOICE_BULK_MAX_IDS;
  const running = run.status === "running";

  async function confirm() {
    if (!pending) return;
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const response = await fetch("/api/admin/cleaner-invoices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pending, ids: rows.map((row) => row.id) }),
      });
      const body = (await response.json().catch(() => null)) as (CleanerBulkResponse & { error?: string }) | null;
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
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setExportError(body.error ?? "The export could not be created.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `cleaner-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("The export could not be downloaded.");
    }
  }

  const copy = pending ? COPY[pending] : null;
  return (
    <div className="space-y-2">
      <EBulkBar
        count={rows.length}
        noun={{ one: "invoice", many: "invoices" }}
        summary={money(rows.reduce((sum, row) => sum + row.totalAmount, 0))}
        onClear={onClear}
        busy={running}
        note={tooMany ? `Select at most ${CLEANER_INVOICE_BULK_MAX_IDS} to approve or push.` : undefined}
      >
        {canApprove ? <EBulkButton disabled={tooMany} onClick={() => setPending("approve")}>Approve</EBulkButton> : null}
        <EBulkButton disabled={tooMany} onClick={() => setPending("xero-push")}>Push to Xero</EBulkButton>
        <EBulkButton onClick={exportCsv}>Export CSV</EBulkButton>
      </EBulkBar>
      {exportError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{exportError}</p> : null}
      {run.status === "finished" ? (
        <section role="status" aria-label="Bulk action results" className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.8125rem] font-[600]">{run.response.summary.done} done · {run.response.summary.refused} refused · {run.response.summary.unchanged} no change</p>
            <EButton size="sm" variant="ghost" onClick={() => setRun({ status: "idle" })}>Dismiss</EButton>
          </div>
          <ul className="space-y-1 text-[0.8125rem]">
            {run.response.results.map((result) => (
              <li key={result.id} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-[0.75rem]">{result.invoiceNumber ?? "Not numbered"}</span>
                <span className={result.outcome === "done" ? "text-[hsl(var(--e-success))]" : result.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>
                  {result.outcome === "done" ? "Done" : result.outcome === "refused" ? "Refused" : "No change"}
                </span>
                {result.reason ? <span className="text-[hsl(var(--e-text-secondary))]">{result.reason}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {copy ? (
        <EModal open onClose={() => !running && setPending(null)} eyebrow="Please confirm" title={copy.title}>
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{copy.body}</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono text-[0.75rem]">{row.invoiceNumber ?? "Not numbered"}</span>
                  <span className="min-w-0 flex-1 truncate">{row.cleanerName}</span>
                  <span>{STATUS_LABEL[row.status] ?? row.status}</span>
                </li>
              ))}
            </ul>
            {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
            <div className="flex justify-end gap-2">
              <EButton size="sm" variant="outline" disabled={running} onClick={() => setPending(null)}>Cancel</EButton>
              <EButton size="sm" disabled={running} onClick={confirm}>{running ? "Working…" : `${copy.confirm} ${rows.length}`}</EButton>
            </div>
          </div>
        </EModal>
      ) : null}
    </div>
  );
}
