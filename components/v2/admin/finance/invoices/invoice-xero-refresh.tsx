"use client";

/**
 * "Refresh from Xero" on the list: for the selected invoices (bulk bar) or the
 * invoices in Xero on this page (header). One request to
 * POST /api/admin/invoices/xero-sync; each row's outcome is shown as the
 * server gave it, and an unknown or refused row is never shown as checked.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import {
  XERO_SYNC_MAX_IDS,
  XERO_SYNC_OUTCOME_LABEL,
  type XeroSyncRunSummary,
} from "@/lib/billing/client-invoice-xero-sync-types";

export type XeroRefreshRun =
  | { status: "idle" }
  | { status: "running" }
  | { status: "finished"; summary: XeroSyncRunSummary }
  | { status: "failed"; message: string };

export function useListXeroRefresh(onFinished: () => void) {
  const [run, setRun] = useState<XeroRefreshRun>({ status: "idle" });

  async function refresh(ids: string[]) {
    if (ids.length === 0 || ids.length > XERO_SYNC_MAX_IDS) return;
    setRun({ status: "running" });
    try {
      const response = await fetch("/api/admin/invoices/xero-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = (await response.json().catch(() => null)) as (XeroSyncRunSummary & { error?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.results)) {
        setRun({ status: "failed", message: body?.error ?? "Xero could not be checked. Nothing is reported as checked." });
        return;
      }
      setRun({ status: "finished", summary: body });
      onFinished();
    } catch {
      setRun({ status: "failed", message: "Could not reach the server. Reload the list to see what was stored." });
    }
  }

  return { run, refresh, dismiss: () => setRun({ status: "idle" }) };
}

const TONE: Record<string, string> = {
  recorded: "text-[hsl(var(--e-success))]",
  "in-xero": "text-[hsl(var(--e-success))]",
  "paid-in-xero": "text-[hsl(var(--e-success))]",
  "needs-review": "text-[hsl(var(--e-warning))]",
  unknown: "text-[hsl(var(--e-danger))]",
  skipped: "text-[hsl(var(--e-muted-foreground))]",
};

export function XeroRefreshResults({ run, onDismiss }: { run: XeroRefreshRun; onDismiss: () => void }) {
  if (run.status === "idle") return null;
  if (run.status === "running") {
    return <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Checking Xero…</p>;
  }
  if (run.status === "failed") {
    return (
      <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
        {run.message}
      </p>
    );
  }
  const { summary } = run;
  return (
    <section
      role="status"
      aria-label="Refresh from Xero results"
      className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] font-[600]">
          {summary.skipped === "not-connected"
            ? "Xero is not connected, so nothing was checked."
            : `${summary.counts.recorded} with payments recorded · ${summary.counts["needs-review"]} need review · ${summary.counts.unknown} unknown`}
        </p>
        <EButton size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </EButton>
      </div>
      <ul className="space-y-1 text-[0.8125rem]">
        {summary.results.map((row) => (
          <li key={row.id} className="flex flex-wrap gap-x-2">
            <span className="font-mono text-[0.75rem]">{row.invoiceNumber ?? row.id}</span>
            <span className={TONE[row.outcome]}>{XERO_SYNC_OUTCOME_LABEL[row.outcome]}</span>
            {row.paymentsRecorded ? <span>{row.paymentsRecorded} payment{row.paymentsRecorded === 1 ? "" : "s"}</span> : null}
            {row.reason ? <span className="text-[hsl(var(--e-text-secondary))]">{row.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
