"use client";

/**
 * "Create N drafts" from Ready to bill: the existing generator run once per
 * client with finished, unbilled work (POST /api/admin/invoices/generate-batch),
 * with the single generator's options. Shows each client's own outcome. The
 * request key is made once per dialog and kept for a retry after a lost
 * answer, so a retry never creates a second set; nothing is approved or sent.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import type { ReadyToBillSummary } from "@/lib/billing/ready-to-bill";
import type { BatchClientOutcome, BatchGenerateResponse } from "@/lib/billing/client-invoice-batch-generate";
import { money } from "./invoice-model";
import { invoiceEditorHref } from "./invoice-links";

type PeriodBasis = "SCHEDULED" | "SERVICE";

type ReadyState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; summary: ReadyToBillSummary };

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "failed"; message: string }
  | { status: "done"; response: BatchGenerateResponse };

const OUTCOME_TEXT: Record<BatchClientOutcome["outcome"], string> = {
  created: "Draft created",
  refused: "Refused",
  nothing: "Nothing billable",
  failed: "Failed",
};

function newRequestKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `drafts:${random}`;
}

function useReadyToBill(): ReadyState {
  const [state, setState] = useState<ReadyState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/invoices?view=ready-to-bill", { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body?.byClient)) {
          setState({ status: "error", message: body?.error ?? "The clients to bill could not be loaded." });
          return;
        }
        setState({ status: "ready", summary: body as ReadyToBillSummary });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: "The clients to bill could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, []);
  return state;
}

function OutcomeList({ response }: { response: BatchGenerateResponse }) {
  const { summary } = response;
  return (
    <section role="status" aria-label="Draft results" className="space-y-2">
      <p className="text-[0.8125rem] font-[600]">
        {summary.created} created · {summary.refused} refused · {summary.nothing} nothing billable · {summary.failed} failed
        {response.replayed ? " (from the earlier request; nothing new was created)" : ""}
      </p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
        {response.results.map((row) => (
          <li key={row.clientId} className="flex flex-wrap gap-x-2">
            <span className="min-w-0 flex-1 break-words font-[550]">{row.clientName}</span>
            <span className={row.outcome === "created" ? "text-[hsl(var(--e-success))]" : row.outcome === "nothing" ? "text-[hsl(var(--e-muted-foreground))]" : "text-[hsl(var(--e-danger))]"}>
              {OUTCOME_TEXT[row.outcome]}
            </span>
            {row.invoiceId && row.invoiceNumber ? (
              <a href={invoiceEditorHref(row.invoiceId, "")} className="font-mono text-[0.75rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
                {row.invoiceNumber}
              </a>
            ) : null}
            {row.reason ? <span className="w-full break-words text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BatchDraftsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ready = useReadyToBill();
  const [requestKey] = useState(newRequestKey);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodBasis, setPeriodBasis] = useState<PeriodBasis>("SCHEDULED");
  const [gstEnabled, setGstEnabled] = useState(true);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const running = run.status === "running";
  const finished = run.status === "done";
  const periodInvalid = Boolean(periodStart && periodEnd && periodStart > periodEnd);

  async function submit() {
    setRun({ status: "running" });
    try {
      const response = await fetch("/api/admin/invoices/generate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey, periodStart: periodStart || null, periodEnd: periodEnd || null, periodBasis, gstEnabled }),
      });
      const body = (await response.json().catch(() => null)) as (BatchGenerateResponse & { error?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.results)) {
        setRun({ status: "failed", message: body?.error ?? "The drafts could not be created. Nothing is reported as created." });
        return;
      }
      setRun({ status: "done", response: body });
      onDone();
    } catch {
      // The same key is sent again on retry, so a lost answer never creates a second set.
      setRun({ status: "failed", message: "No answer from the server. Some drafts may have been created; Retry shows what happened without creating them twice." });
    }
  }

  const clients = ready.status === "ready" ? ready.summary.byClient : [];
  return (
    <EModal open onClose={() => !running && onClose()} eyebrow="Ready to bill" title={clients.length ? `Create ${clients.length} draft${clients.length === 1 ? "" : "s"}` : "Create drafts"} wide>
      <div className="space-y-4">
        {ready.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading the clients with unbilled work…</p> : null}
        {ready.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{ready.message}</p> : null}
        {ready.status === "ready" && !finished ? (
          <>
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              The draft generator runs once for each client below, one after another, billing finished work only. Each draft is
              left for review: nothing is approved, sent or pushed to Xero. A client with a job that has no rate is refused by
              the generator and keeps its work unbilled.
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
              {clients.map((client) => (
                <li key={client.clientId} className="flex flex-wrap justify-between gap-x-2">
                  <span className="min-w-0 flex-1 break-words">{client.clientName}</span>
                  <span className="e-tnum">{client.jobs} job{client.jobs === 1 ? "" : "s"} · {money(client.total)}</span>
                  {client.unratedJobs ? <span className="w-full text-[0.75rem] text-[hsl(var(--e-warning))]">{client.unratedJobs} without a rate: the generator will refuse this client</span> : null}
                </li>
              ))}
            </ul>
            {/* Frozen once sent: a retry must carry the same options as its key. */}
            <fieldset disabled={running || run.status === "failed"} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <EField label="Period from">
                  <EInput type="date" aria-label="Period from" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
                </EField>
                <EField label="Period to">
                  <EInput type="date" aria-label="Period to" value={periodEnd} min={periodStart || undefined} onChange={(event) => setPeriodEnd(event.target.value)} />
                </EField>
              </div>
              <EField label="Bill jobs by" hint="Which date the period is measured against. Only applies when a period is set.">
                <ESelect aria-label="Bill jobs by" value={periodBasis} onChange={(event) => setPeriodBasis(event.target.value as PeriodBasis)}>
                  <option value="SCHEDULED">Scheduled date — matches the date printed on each line</option>
                  <option value="SERVICE">Completion date - scheduled date for unfinished work</option>
                </ESelect>
              </EField>
              <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
                <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Include GST (10%)</span>
                <ESwitch checked={gstEnabled} onCheckedChange={setGstEnabled} />
              </div>
            </fieldset>
            {periodInvalid ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">The period start must be on or before its end.</p> : null}
          </>
        ) : null}
        {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
        {finished ? <OutcomeList response={run.response} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <EButton size="sm" variant="outline" disabled={running} onClick={onClose}>
            {finished ? "Close" : "Cancel"}
          </EButton>
          {!finished ? (
            <EButton size="sm" variant="gold" disabled={running || ready.status !== "ready" || clients.length === 0 || periodInvalid} onClick={submit}>
              {running ? "Creating drafts…" : run.status === "failed" ? "Retry" : `Create ${clients.length} draft${clients.length === 1 ? "" : "s"}`}
            </EButton>
          ) : null}
        </div>
      </div>
    </EModal>
  );
}
