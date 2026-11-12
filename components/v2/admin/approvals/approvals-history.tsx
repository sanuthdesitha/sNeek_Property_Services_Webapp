"use client";

/**
 * Approvals → Decided tab: every decision taken here, newest first, read from
 * GET /api/admin/approvals/history. Filters: queue, decided by, from / to date,
 * search, and the "Paid above request" chip (pay requests approved above what
 * the cleaner requested and not yet paid, for the owner to review; read only).
 * Each row's "more" menu offers Change amount, Reverse and Delete only
 * as the server's capability map allows, with the server's reason when not.
 * Delete (administrators only, as the server decides) asks for a typed DELETE
 * and the administrator's own PIN, verified by the server.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { cn } from "@/lib/utils";
import { APPROVAL_QUEUES, isApprovalsQueueKey } from "@/lib/admin/approvals/queues";
import { money } from "@/lib/admin/approvals/rows";
import { formatInstant } from "./panel/panel-kit";
import { ChangeAmountDialog } from "./change-amount-dialog";

type Verb = "edit" | "undo" | "delete";

export type HistoryRow = {
  id: string;
  createdAt: string;
  queue: string;
  decision: "APPROVED" | "DECLINED" | "DISMISSED" | "REVERSED" | "EDITED" | "DELETED";
  entityId: string;
  label: string | null;
  amount: number | null;
  value: number | null;
  note: string | null;
  subjectName: string | null;
  decidedBy: { id: string; name: string | null; email: string; role: string } | null;
  href: string | null;
  currentAmount: number | null;
  settled: boolean;
  /** Approved above the cleaner's request and not yet paid (pay requests only). */
  paidAboveRequest?: boolean;
  requestedAmount?: number | null;
  capabilities: { canEdit: boolean; canUndo: boolean; canDelete: boolean; reasons: Partial<Record<Verb, string>> };
};

type Filters = { queue: string; deciderId: string; from: string; to: string; paidAboveRequest: boolean };

const DECISION: Record<HistoryRow["decision"], { label: string; tone: EPillTone }> = {
  APPROVED: { label: "Approved", tone: "ok" },
  DECLINED: { label: "Declined", tone: "bad" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
  REVERSED: { label: "Reversed", tone: "warn" },
  EDITED: { label: "Amount changed", tone: "info" },
  DELETED: { label: "Deleted", tone: "bad" },
};

const INPUT = "h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]";

function queueLabel(queue: string): string {
  return isApprovalsQueueKey(queue) ? APPROVAL_QUEUES[queue].label : queue;
}

export function ApprovalsHistory({ timezone = "Australia/Sydney" }: { timezone?: string }) {
  const [rows, setRows] = React.useState<HistoryRow[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [acting, setActing] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<Filters>({ queue: "", deciderId: "", from: "", to: "", paidAboveRequest: false });
  const [search, setSearch] = useRestorableState("approvals-history:search", "");
  const [editRow, setEditRow] = React.useState<HistoryRow | null>(null);
  const [deleteRow, setDeleteRow] = React.useState<HistoryRow | null>(null);
  // Only an administrator may delete a decision record; the list read says so.
  const [canDeleteRecords, setCanDeleteRecords] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);

  const load = React.useCallback(
    async (after: string | null = null) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setLoading(true);
      const qs = new URLSearchParams();
      if (filters.queue) qs.set("queue", filters.queue);
      if (filters.deciderId) qs.set("deciderId", filters.deciderId);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      if (filters.paidAboveRequest) qs.set("paidAboveRequest", "1");
      if (search.trim()) qs.set("q", search.trim());
      if (after) qs.set("cursor", after);
      try {
        const res = await fetch(`/api/admin/approvals/history?${qs.toString()}`, { cache: "no-store", signal: current.signal });
        const body = (await res.json().catch(() => null)) as { items?: HistoryRow[]; nextCursor?: string | null; canDeleteRecords?: boolean; error?: string } | null;
        if (current.signal.aborted) return;
        if (!res.ok || !body) {
          setError(body?.error ?? "Could not load decisions.");
          return;
        }
        setRows((existing) => (after ? [...existing, ...(body.items ?? [])] : body.items ?? []));
        setCursor(body.nextCursor ?? null);
        setCanDeleteRecords(body.canDeleteRecords === true);
        setError(null);
      } catch {
        if (!current.signal.aborted) setError("Could not load decisions.");
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    },
    [filters, search],
  );

  React.useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const deciders = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) if (row.decidedBy) map.set(row.decidedBy.id, row.decidedBy.name || row.decidedBy.email);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [rows]);

  async function act(row: HistoryRow, action: Verb, extra: Record<string, unknown> = {}): Promise<boolean> {
    setActing(row.id);
    try {
      const res = await fetch(`/api/admin/approvals/history/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      toast({ title: action === "undo" ? "Decision reversed" : action === "delete" ? "Record deleted" : "Amount updated" });
      await load();
      return true;
    } catch (err) {
      toast({ title: "Not changed", description: err instanceof Error ? err.message : "Action failed", variant: "destructive" });
      return false;
    } finally {
      setActing(null);
    }
  }

  const columns: Array<EDataColumn<HistoryRow>> = [
    { key: "when", header: "Decided", cell: (row) => <span className="e-tnum whitespace-nowrap">{formatInstant(row.createdAt, timezone, "d MMM HH:mm")}</span> },
    {
      key: "request",
      header: "Request",
      cell: (row) => (
        <div className="min-w-0">
          {[queueLabel(row.queue), row.subjectName, row.label].filter(Boolean).join(" · ")}
          {row.note ? <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.note}</div> : null}
        </div>
      ),
    },
    {
      key: "decision",
      header: "Decision",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <EPill tone={DECISION[row.decision]?.tone ?? "neutral"}>
            {DECISION[row.decision]?.label ?? row.decision}
            {row.amount != null ? ` ${money(row.amount)}` : row.value != null ? ` ${row.value}` : ""}
          </EPill>
          {row.settled ? <EPill tone="gold">Settled</EPill> : null}
          {row.paidAboveRequest ? (
            <EPill tone="warn">Paid above request{row.requestedAmount != null ? ` (asked ${money(row.requestedAmount)})` : ""}</EPill>
          ) : null}
          {row.currentAmount != null && row.amount != null && Math.abs(row.currentAmount) !== Math.abs(row.amount) ? (
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">now {money(row.currentAmount)}</span>
          ) : null}
        </span>
      ),
    },
    { key: "by", header: "By", cell: (row) => row.decidedBy?.name || row.decidedBy?.email || "—" },
    {
      key: "more",
      header: <span className="sr-only">More</span>,
      cell: (row) => (
        <ERowMenu
          label={`More actions for ${row.label ?? "this decision"}`}
          disabled={acting === row.id}
          footnote={canDeleteRecords ? "Delete asks for your own PIN." : undefined}
          items={[
            ...(row.href ? [{ key: "open", label: "Open", href: row.href }] : []),
            { key: "edit", label: "Change amount", disabled: !row.capabilities.canEdit, hint: row.capabilities.reasons.edit, onSelect: () => setEditRow(row), separated: Boolean(row.href) },
            { key: "undo", label: "Reverse decision", disabled: !row.capabilities.canUndo, hint: row.capabilities.reasons.undo, onSelect: () => void act(row, "undo") },
            ...(canDeleteRecords
              ? [{ key: "delete", label: "Delete record", danger: true, separated: true, disabled: !row.capabilities.canDelete, hint: row.capabilities.reasons.delete, onSelect: () => setDeleteRow(row) }]
              : []),
          ]}
        />
      ),
    },
  ];

  const deciderName = deciders.find((item) => item.id === filters.deciderId)?.name ?? (filters.deciderId ? "selected" : null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <EFilterPopover label="Queue" value={filters.queue ? queueLabel(filters.queue) : null} emptyValue="all">
          <label className="block text-[0.75rem] font-[550]" htmlFor="history-queue">Queue</label>
          <select id="history-queue" className={INPUT} value={filters.queue} onChange={(e) => setFilters((f) => ({ ...f, queue: e.target.value }))}>
            <option value="">All queues</option>
            {Object.values(APPROVAL_QUEUES).map((queue) => (
              <option key={queue.key} value={queue.key}>{queue.label}</option>
            ))}
          </select>
        </EFilterPopover>
        <EFilterPopover label="Decided by" value={deciderName} emptyValue="anyone">
          <label className="block text-[0.75rem] font-[550]" htmlFor="history-decider">Decided by</label>
          <select id="history-decider" className={INPUT} value={filters.deciderId} onChange={(e) => setFilters((f) => ({ ...f, deciderId: e.target.value }))}>
            <option value="">Anyone</option>
            {deciders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </EFilterPopover>
        <EFilterPopover label="Dates" value={filters.from || filters.to ? `${filters.from || "…"} to ${filters.to || "…"}` : null} emptyValue="any">
          <label className="block text-[0.75rem] font-[550]" htmlFor="history-from">From date</label>
          <input id="history-from" type="date" className={INPUT} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <label className="block text-[0.75rem] font-[550]" htmlFor="history-to">To date</label>
          <input id="history-to" type="date" className={INPUT} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </EFilterPopover>
        <button
          type="button"
          aria-pressed={filters.paidAboveRequest}
          className={cn(E_CHIP_CLASS, filters.paidAboveRequest && E_CHIP_ON_CLASS)}
          onClick={() => setFilters((f) => ({ ...f, paidAboveRequest: !f.paidAboveRequest }))}
        >
          Paid above request
        </button>
        <label className="sr-only" htmlFor="history-search">Search decisions</label>
        <input id="history-search" className={INPUT + " h-9 sm:w-[220px]"} placeholder="Search property, note, person" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <EDataTable
          label="Decided requests"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyTitle="No decisions match these filters"
          minWidth="680px"
        />
      </div>
      {cursor ? (
        <EButton size="sm" variant="outline" disabled={loading} onClick={() => void load(cursor)}>Show older decisions</EButton>
      ) : null}
      <ChangeAmountDialog row={editRow} busy={Boolean(acting)} onClose={() => setEditRow(null)} onSave={async (row, amount, note) => { if (await act(row, "edit", { amount, note })) setEditRow(null); }} />
      <EConfirmModal
        open={Boolean(deleteRow)}
        onClose={() => setDeleteRow(null)}
        title="Delete this approval record"
        description="The decision, who made it and the amount attached to it are removed from the history for good. Enter your own PIN to continue."
        confirmLabel="Delete record"
        confirmPhrase="DELETE"
        requireSecurity
        loading={Boolean(acting)}
        onConfirm={async (credentials) => {
          const row = deleteRow;
          if (!row) return;
          if (await act(row, "delete", { security: credentials })) setDeleteRow(null);
        }}
      />
    </div>
  );
}
