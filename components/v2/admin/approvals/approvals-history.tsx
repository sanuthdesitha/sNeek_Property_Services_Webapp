"use client";

/**
 * Approval Center → History tab.
 *
 * Reverse-chronological record of every decision taken in the Approval Center,
 * read from GET /api/admin/approvals/history (AuditLog under one action), with
 * per-item Edit / Undo / Delete driven by the server's capability map.
 *
 * The buttons are rendered from `row.capabilities` — never from a local guess —
 * so the UI can only ever offer verbs the server will honour, and an unavailable
 * verb shows the server's own reason on hover instead of vanishing without
 * explanation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowRight, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";

type Capabilities = {
  canEdit: boolean;
  canUndo: boolean;
  canDelete: boolean;
  reasons: Partial<Record<"edit" | "undo" | "delete", string>>;
};

type HistoryRow = {
  id: string;
  createdAt: string;
  queue: string;
  decision: "APPROVED" | "DECLINED" | "DISMISSED" | "REVERSED" | "EDITED" | "DELETED";
  entity: string;
  entityId: string;
  jobId: string | null;
  label: string | null;
  amount: number | null;
  value: number | null;
  note: string | null;
  subjectName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  decidedBy: { id: string; name: string | null; email: string; role: string } | null;
  href: string | null;
  currentStatus: string | null;
  currentAmount: number | null;
  settled: boolean;
  capabilities: Capabilities;
};

const QUEUE_LABELS: Record<string, string> = {
  continuations: "Continuations",
  timingRequests: "Timing",
  payAdjustments: "Pay requests",
  timeAdjustments: "Clock",
  clientApprovals: "Client approvals",
  flaggedLaundry: "Laundry",
  rescheduleRequests: "Reschedules",
  clientRequests: "Client requests",
  qaReworkTransfers: "QA reworks",
  qaOutcomes: "QA outcomes",
  skipRequests: "Skips",
  rectificationAdjustments: "Rectifications",
  bonusProposals: "Bonuses",
  falseConfirmations: "False confirmations",
  managementReviews: "Management reviews",
};

function decisionTone(decision: HistoryRow["decision"]) {
  switch (decision) {
    case "APPROVED":
      return "success" as const;
    case "DECLINED":
    case "DELETED":
      return "danger" as const;
    case "REVERSED":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy HH:mm");
  } catch {
    return String(value);
  }
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null;
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

const FIELD_CLS =
  "h-9 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function ApprovalsHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  // Filters
  const [queue, setQueue] = useState("");
  const [deciderId, setDeciderId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  // Edit modal
  const [editRow, setEditRow] = useState<HistoryRow | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (queue) qs.set("queue", queue);
      if (deciderId) qs.set("deciderId", deciderId);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (search.trim()) qs.set("q", search.trim());
      const res = await fetch(`/api/admin/approvals/history?${qs.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setRows(body.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [queue, deciderId, from, to, search]);

  useEffect(() => {
    load();
  }, [load]);

  /** Everyone who appears as a decider in the current result set. */
  const deciders = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.decidedBy) map.set(row.decidedBy.id, row.decidedBy.name || row.decidedBy.email);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [rows]);

  async function act(row: HistoryRow, action: "edit" | "undo" | "delete", extra: object = {}) {
    setActing(row.id);
    try {
      const res = await fetch(`/api/admin/approvals/history/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      toast({
        title:
          action === "undo"
            ? "Decision reversed"
            : action === "delete"
            ? "Request deleted"
            : "Amount updated",
      });
      setEditRow(null);
      await load();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Action failed", variant: "destructive" });
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <ECard className="flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="flex flex-col gap-1">
          <EEyebrow>Queue</EEyebrow>
          <select className={FIELD_CLS} value={queue} onChange={(e) => setQueue(e.target.value)}>
            <option value="">All queues</option>
            {Object.entries(QUEUE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <EEyebrow>Decided by</EEyebrow>
          <select
            className={FIELD_CLS}
            value={deciderId}
            onChange={(e) => setDeciderId(e.target.value)}
          >
            <option value="">Anyone</option>
            {deciders.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <EEyebrow>From</EEyebrow>
          <input type="date" className={FIELD_CLS} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <EEyebrow>To</EEyebrow>
          <input type="date" className={FIELD_CLS} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <EEyebrow>Search</EEyebrow>
          <input
            className={FIELD_CLS}
            placeholder="Property, note, person…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <EButton variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
          Refresh
        </EButton>
      </ECard>

      {/* ── Rows ── */}
      {loading && rows.length === 0 ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading history…
        </ECard>
      ) : rows.length === 0 ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No decisions match these filters.
        </ECard>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const busy = acting === row.id;
            const amountLabel = money(row.amount);
            return (
              <ECard key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <EBadge tone={decisionTone(row.decision)} soft>
                        {row.decision.charAt(0) + row.decision.slice(1).toLowerCase()}
                      </EBadge>
                      <EBadge tone="neutral">{QUEUE_LABELS[row.queue] ?? row.queue}</EBadge>
                      {row.settled ? <EBadge tone="gold">Settled</EBadge> : null}
                      <p className="text-[0.875rem] font-[550]">{row.label ?? row.entityId}</p>
                    </div>
                    <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {fmt(row.createdAt)}
                      {row.decidedBy ? ` · by ${row.decidedBy.name || row.decidedBy.email}` : ""}
                      {row.subjectName ? ` · for ${row.subjectName}` : ""}
                      {row.fromStatus && row.toStatus && row.fromStatus !== row.toStatus
                        ? ` · ${row.fromStatus} → ${row.toStatus}`
                        : ""}
                    </p>
                    {row.note ? (
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{row.note}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {amountLabel ? (
                      <span className="e-numeral text-[0.9375rem]">{amountLabel}</span>
                    ) : row.value != null ? (
                      <span className="e-tnum text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        {row.value}
                      </span>
                    ) : null}

                    <EButton
                      size="sm"
                      variant="ghost"
                      disabled={busy || !row.capabilities.canEdit}
                      title={row.capabilities.reasons.edit}
                      onClick={() => {
                        setEditRow(row);
                        setEditAmount(
                          row.currentAmount != null
                            ? Math.abs(row.currentAmount).toFixed(2)
                            : row.amount != null
                            ? Math.abs(row.amount).toFixed(2)
                            : ""
                        );
                        setEditNote("");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </EButton>
                    <EButton
                      size="sm"
                      variant="outline"
                      disabled={busy || !row.capabilities.canUndo}
                      title={row.capabilities.reasons.undo}
                      onClick={() => void act(row, "undo")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Undo
                    </EButton>
                    <EButton
                      size="sm"
                      variant="danger"
                      disabled={busy || !row.capabilities.canDelete}
                      title={row.capabilities.reasons.delete}
                      onClick={() => void act(row, "delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </EButton>
                    {row.href ? (
                      <EButton size="sm" variant="ghost" asChild>
                        <Link href={row.href}>
                          Open <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </EButton>
                    ) : null}
                  </div>
                </div>
              </ECard>
            );
          })}
        </div>
      )}

      {/* ── Edit modal ── */}
      <EModal
        open={Boolean(editRow)}
        onClose={() => setEditRow(null)}
        eyebrow="Correction"
        title="Change the decided amount"
      >
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {editRow?.label ?? "This request"} — re-pricing notifies the person it affects.
          </p>
          <EField label="Amount ($)">
            <EInput
              inputMode="decimal"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
            />
          </EField>
          <EField label="Note (optional)">
            <ETextarea
              rows={3}
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Why the amount changed"
            />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setEditRow(null)}>
              Cancel
            </EButton>
            <EButton
              variant="gold"
              size="sm"
              disabled={Boolean(acting) || !editAmount.trim()}
              onClick={() => {
                if (!editRow) return;
                const value = Number(editAmount);
                if (!Number.isFinite(value) || value <= 0) {
                  toast({ title: "Enter an amount greater than zero.", variant: "destructive" });
                  return;
                }
                void act(editRow, "edit", { amount: value, note: editNote.trim() || undefined });
              }}
            >
              Save amount
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
