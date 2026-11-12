"use client";

/**
 * The stat cards above the client-invoice table. Every figure is a stored
 * aggregate from GET /api/admin/invoices?view=stats; each caption says what it
 * counts. A failed read says so rather than showing zeros.
 */
import { useEffect, useState } from "react";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";
import { EPill } from "@/components/v2/ui/pill";
import type { ClientInvoiceStats, InvoicedThisMonth } from "@/lib/billing/client-invoice-stats";
import { fmtDay, money } from "./invoice-model";

/** Says exactly what the figure counts: first sends this month, less credit notes sent. */
function invoicedCaption(figure: InvoicedThisMonth): string {
  const invoices = `${figure.invoiceCount} invoice${figure.invoiceCount === 1 ? "" : "s"} first sent since ${fmtDay(figure.monthStart)}`;
  const credits = figure.creditNoteCount > 0
    ? `, less ${figure.creditNoteCount} credit note${figure.creditNoteCount === 1 ? "" : "s"} (${money(figure.creditTotal)})`
    : "";
  return `${invoices}${credits}, incl. GST. Approved but unsent is not counted`;
}

type StatsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: ClientInvoiceStats };

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function StatCard({ label, value, aside, caption }: { label: string; value: React.ReactNode; aside?: React.ReactNode; caption: React.ReactNode }) {
  return (
    <ECard className="min-w-0 flex-1 px-4 py-3.5">
      <EEyebrow>{label}</EEyebrow>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="e-numeral text-[1.75rem] leading-none">{value}</span>
        {aside}
      </div>
      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{caption}</p>
    </ECard>
  );
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "22 finished jobs not on an invoice, 4 clients · 3 jobs have no rate" */
function readyCaption(ready: ClientInvoiceStats["readyToBill"]): string {
  if (ready.jobs === 0) return "No finished jobs are waiting to be invoiced";
  const base = `${plural(ready.jobs, "finished job")} not on an invoice, ${plural(ready.clients, "client")}`;
  if (ready.unratedJobs === 0) return base;
  return `${base} · ${plural(ready.unratedJobs, "job")} ${ready.unratedJobs === 1 ? "has" : "have"} no rate (not in the total)`;
}

export function InvoiceStats({
  reloadToken,
  onCreateDrafts,
  canCreate,
}: {
  reloadToken: number;
  /** Opens "Create N drafts" for the clients with finished, unbilled work. */
  onCreateDrafts: () => void;
  canCreate: boolean;
}) {
  const [state, setState] = useState<StatsState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/invoices?view=stats", { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.drafts) {
          setState({ status: "error", message: body?.error ?? "Invoice figures could not be loaded." });
          return;
        }
        setState({ status: "ready", stats: body as ClientInvoiceStats });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: "Invoice figures could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [reloadToken]);

  if (state.status === "loading") {
    return <p role="status" className="sr-only">Loading invoice figures…</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">
        {state.message}
      </p>
    );
  }
  const { readyToBill, drafts, outstanding, paidThisMonth, invoicedThisMonth } = state.stats;
  // On a phone the figures fold behind one row (owner decision 2026-11-13); unchanged from 640px.
  return (
    <CollapsibleFigures storageKey="money:client-invoices" count={invoicedThisMonth ? 5 : 4} label="Client invoice figures">
      <section aria-label="Client invoice figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Ready to bill"
          value={money(readyToBill.total)}
          aside={
            readyToBill.clients > 0 ? (
              <EButton size="sm" variant="gold" onClick={onCreateDrafts} disabled={!canCreate}>
                Create {plural(readyToBill.clients, "draft")}
              </EButton>
            ) : null
          }
          caption={readyCaption(readyToBill)}
        />
        <StatCard
          label="Drafts to review"
          value={drafts.count}
          aside={
            drafts.missingRateJobs > 0 ? (
              <span title={`${plural(drafts.missingRateDrafts, "draft")} with a job that has no client rate now. Approval refuses them until a rate is set.`}>
                <EPill tone="warn">
                  {drafts.missingRateJobs} missing rate{drafts.missingRateJobs === 1 ? "" : "s"}
                </EPill>
              </span>
            ) : null
          }
          caption={
            drafts.missingRateDrafts > 0
              ? `${money(drafts.total)} in drafts · ${plural(drafts.missingRateDrafts, "draft")} blocked by missing rates`
              : `${money(drafts.total)} in drafts`
          }
        />
        <StatCard
          label="Outstanding"
          value={money(outstanding.owing)}
          aside={outstanding.overdue > 0 ? <EPill tone="bad">{outstanding.overdue} overdue</EPill> : null}
          caption={
            outstanding.oldest
              ? `Oldest issued ${daysAgo(outstanding.oldest.createdAt)} days ago · ${outstanding.oldest.clientName}`
              : "Nothing sent is waiting on payment"
          }
        />
        {invoicedThisMonth ? (
          <StatCard
            label="Invoiced this month"
            value={money(invoicedThisMonth.total)}
            caption={invoicedCaption(invoicedThisMonth)}
          />
        ) : null}
        <StatCard
          label="Paid this month"
          value={money(paidThisMonth.total)}
          caption={`${paidThisMonth.count} invoice${paidThisMonth.count === 1 ? "" : "s"} paid in full since ${fmtDay(paidThisMonth.monthStart)}, as recorded here`}
        />
      </section>
    </CollapsibleFigures>
  );
}
