"use client";

/**
 * Approvals (owner board "Approvals", 2026-11): every request waiting on a
 * decision. Left: the queues grouped by kind with real counts, empty queues
 * folded. Middle: the selected queue as a table, oldest first, one primary
 * action per row, bulk decisions where a queue allows them. Right: the side
 * panel with that queue's own decision controls (?open=<id>). The Decided tab
 * holds the history with its corrections.
 *
 * Every decision goes to the same route and body as before the redesign; see
 * panel/* and lib/admin/approvals/*.
 */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { cn } from "@/lib/utils";
import { APPROVAL_QUEUES, APPROVAL_QUEUE_ORDER, type ApprovalsQueueKey, type BulkDecision } from "@/lib/admin/approvals/queues";
import { DAY_MS, allRows, rowsForQueue, sortByWaiting, waitedMs, type ApprovalQueueRow, type WaitingOrder } from "@/lib/admin/approvals/rows";
import { ApprovalsHistory } from "./approvals-history";
import { QueueNav } from "./queue-nav";
import { QueueTable } from "./queue-table";
import { BulkDecisionBar } from "./bulk-decision";
import { ApprovalPanel } from "./panel/approval-panel";
import type { DecideRequest } from "./panel/panel-kit";
import type { RowPrimary } from "./row-actions";
import { useApprovalsData, useApprovalsUrl, type QueueSelection } from "./use-approvals-state";

const DEFAULT_TIMEZONE = "Australia/Sydney";

function headerLine(total: number | null, older: number, olderIsFloor: boolean): string {
  if (total == null) return "Every request waiting on a decision, grouped by queue.";
  if (total === 0) return "Nothing is waiting on a decision.";
  const olderText = older > 0 ? ` · ${olderIsFloor ? "at least " : ""}${older} older than 24 hours` : "";
  return `${total} request${total === 1 ? "" : "s"} waiting on a decision${olderText}`;
}

export function ApprovalsWorkspace({ timezone = DEFAULT_TIMEZONE }: { timezone?: string }) {
  const { data, loading, error, reload } = useApprovalsData();
  const [url, setUrl, urlReady] = useApprovalsUrl();
  const [order, setOrder] = React.useState<WaitingOrder>("oldest");
  const [deciding, setDeciding] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmPrimary, setConfirmPrimary] = React.useState<{ row: ApprovalQueueRow; action: Extract<RowPrimary, { kind: "approve" }> } | null>(null);
  const [bulkRequest, setBulkRequest] = React.useState<{ decision: BulkDecision; ids: string[] } | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const clearBulkRequest = React.useCallback(() => setBulkRequest(null), []);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Without ?queue=, land on the first queue that has work, once data arrives.
  const queue: QueueSelection = url.queue ?? (data ? APPROVAL_QUEUE_ORDER.find((key) => (data.counts[key] ?? 0) > 0) ?? "all" : "all");

  // A different queue never carries the previous queue's selection.
  React.useEffect(() => setSelected(new Set()), [queue]);

  const rows = React.useMemo(() => {
    if (!data) return [];
    return sortByWaiting(queue === "all" ? allRows(data) : rowsForQueue(data, queue), order);
  }, [data, queue, order]);

  const everyRow = React.useMemo(() => (data ? allRows(data) : []), [data]);
  const total = data?.counts.total ?? null;
  const older = everyRow.filter((row) => (waitedMs(row, now) ?? 0) >= DAY_MS).length;
  const olderIsFloor = data ? APPROVAL_QUEUE_ORDER.some((key) => (data.counts[key] ?? 0) > (data[key]?.length ?? 0)) : false;
  const openRow = url.open ? (rows.find((row) => row.id === url.open) ?? everyRow.find((row) => row.id === url.open) ?? null) : null;

  const decide = React.useCallback(
    async (request: DecideRequest): Promise<boolean> => {
      setDeciding(true);
      try {
        const res = await fetch(request.url, { method: request.method ?? "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
        const json = (await res.json().catch(() => ({}))) as { error?: string; approved?: unknown[]; skipped?: unknown[] };
        if (!res.ok) throw new Error(json.error ?? "The decision was refused.");
        if (Array.isArray(json.skipped) && json.skipped.length > 0 && (json.approved?.length ?? 0) === 0) {
          toast({ title: "No change", description: "This job is no longer awaiting approval." });
        } else {
          toast({ title: request.successMsg });
        }
        setUrl({ open: null });
        await reload();
        return true;
      } catch (err) {
        // The panel stays open with what was typed, so the decision can be retried.
        toast({ title: "Not decided", description: err instanceof Error ? err.message : "The decision was refused.", variant: "destructive" });
        return false;
      } finally {
        setDeciding(false);
      }
    },
    [reload, setUrl],
  );

  function selectQueue(next: QueueSelection) {
    setUrl({ queue: next, open: null });
  }

  function onPrimary(row: ApprovalQueueRow, action: RowPrimary) {
    if (action.kind === "review") setUrl({ open: row.id });
    else if (action.kind === "approve") {
      if (action.confirm) setConfirmPrimary({ row, action });
      else void decide({ url: action.url, method: action.method, body: action.body, successMsg: action.successMsg });
    }
  }

  const selectedRows = rows.filter((row) => selected.has(`${row.queue}:${row.id}`));

  const waitingCount = total ?? 0;
  const tabs = (
    <div role="tablist" aria-label="Approvals" className="inline-flex gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
      {(["waiting", "decided"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={url.tab === key}
          onClick={() => setUrl({ tab: key, open: null })}
          className={cn(
            "inline-flex min-h-[36px] items-center gap-1.5 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550]",
            url.tab === key ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]",
          )}
        >
          {key === "waiting" ? <>Waiting {total != null ? <span className="e-tnum">{waitingCount}</span> : null}</> : "Decided"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow="Daily work"
        title="Approvals"
        description={headerLine(total, older, olderIsFloor)}
        actions={
          <>
            {url.tab === "waiting" ? (
              <label className="flex items-center gap-2 text-[0.8125rem]">
                <span className="sr-only">Order</span>
                <select
                  value={order}
                  onChange={(event) => setOrder(event.target.value as WaitingOrder)}
                  className="h-9 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]"
                >
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </select>
              </label>
            ) : null}
            <EButton variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
              <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </EButton>
          </>
        }
      />
      {tabs}
      {url.tab === "decided" ? (
        <ApprovalsHistory timezone={timezone} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
          <div className="hidden w-[212px] shrink-0 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 lg:block">
            <QueueNav counts={data?.counts ?? null} active={queue} onSelect={selectQueue} />
          </div>
          <label className="flex flex-col gap-1 lg:hidden">
            <span className="text-[0.75rem] font-[550]">Queue</span>
            <select
              value={queue}
              onChange={(event) => selectQueue(event.target.value as QueueSelection)}
              className="h-11 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px]"
            >
              <option value="all">All waiting{total != null ? ` (${total})` : ""}</option>
              {APPROVAL_QUEUE_ORDER.map((key) => (
                <option key={key} value={key}>{APPROVAL_QUEUES[key].label}{data ? ` (${data.counts[key] ?? 0})` : ""}</option>
              ))}
            </select>
          </label>
          <section aria-label={queue === "all" ? "All waiting" : APPROVAL_QUEUES[queue].label} className="flex min-w-0 flex-1 flex-col gap-3">
            {urlReady ? (
              <QueueTable
                queue={queue}
                rows={rows}
                total={queue === "all" ? total : data?.counts[queue] ?? null}
                now={now}
                loading={loading}
                error={error}
                onRetry={() => void reload()}
                openId={url.open}
                onOpen={(row) => setUrl({ open: row.id })}
                onPrimary={onPrimary}
                onQuickDecline={(row) => {
                  // The row menu's Decline is a one-row bulk decline: same dialog, same route.
                  setSelected(new Set([`${row.queue}:${row.id}`]));
                  setBulkRequest({ decision: "decline", ids: [row.id] });
                }}
                busy={deciding}
                selected={selected}
                onSelectedChange={setSelected}
              />
            ) : null}
            {queue !== "all" ? (
              <BulkDecisionBar
                queue={queue as ApprovalsQueueKey}
                selectedRows={selectedRows}
                onClear={() => setSelected(new Set())}
                request={bulkRequest}
                onRequestHandled={clearBulkRequest}
                onFinished={async (remaining) => {
                  setSelected(new Set(remaining.map((id) => `${queue}:${id}`)));
                  await reload();
                }}
              />
            ) : null}
          </section>
          {openRow ? (
            <ApprovalPanel
              key={`${openRow.queue}:${openRow.id}`}
              row={openRow}
              availability={openRow.queue === "bookingRequests" && openRow.record.scheduledDate ? data?.bookingAvailability[openRow.record.scheduledDate] ?? null : null}
              now={now}
              busy={deciding}
              decide={decide}
              reload={reload}
              timezone={timezone}
              onClose={() => setUrl({ open: null })}
            />
          ) : null}
        </div>
      )}
      <EActionDialog
        open={confirmPrimary !== null}
        title="Approve as asked?"
        busy={deciding}
        onClose={() => setConfirmPrimary(null)}
        footer={
          <>
            <EButton size="sm" variant="ghost" onClick={() => setConfirmPrimary(null)}>Cancel</EButton>
            <EButton
              size="sm"
              onClick={() => {
                const pending = confirmPrimary;
                setConfirmPrimary(null);
                if (pending) void decide({ url: pending.action.url, method: pending.action.method, body: pending.action.body, successMsg: pending.action.successMsg });
              }}
            >
              Approve
            </EButton>
          </>
        }
      >
        <p>{confirmPrimary?.action.confirm}</p>
      </EActionDialog>
    </div>
  );
}
