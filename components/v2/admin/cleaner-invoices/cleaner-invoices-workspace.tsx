"use client";

/**
 * Estate-native admin view of cleaner-submitted invoices (CleanerInvoiceSubmission).
 * Review each cleaner's invoice, push it to Xero, mark it paid, reverse (void) or
 * delete it. Reversing/deleting frees the cleaner to resend a corrected invoice.
 * Same endpoints as v1: GET /api/admin/cleaner-invoices, PATCH/DELETE
 * /api/admin/cleaner-invoices/[id], POST .../[id]/xero-push.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Loader2, RefreshCw, Undo2, Trash2, CheckCircle2, Send, Eye, FileSpreadsheet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  EBadge, EButton, ECard, ECardBody, EEmptyState, EStatCard,
} from "@/components/v2/ui/primitives";
import { ETableShell, EModal, EConfirmModal } from "@/components/v2/admin/estate-kit";

type LineRow = { label?: string; description?: string; hours?: number; rate?: number; amount?: number; jobNumber?: string };
type Submission = {
  id: string;
  cleanerId: string;
  cleanerName: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  totalAmount: number;
  jobCount: number;
  status: "SUBMITTED" | "XERO_PUSHED" | "PAID" | "VOID";
  xeroBillId: string | null;
  xeroExportedAt: string | null;
  lineData: any;
  createdAt: string;
};

const STATUS_TONE: Record<Submission["status"], "info" | "success" | "gold" | "danger"> = {
  SUBMITTED: "info",
  XERO_PUSHED: "gold",
  PAID: "success",
  VOID: "danger",
};
const STATUS_LABEL: Record<Submission["status"], string> = {
  SUBMITTED: "Submitted",
  XERO_PUSHED: "In Xero",
  PAID: "Paid",
  VOID: "Reversed",
};

function money(v: number | null | undefined) {
  return `$${Number(v ?? 0).toFixed(2)}`;
}
function fmt(d: string | null) {
  if (!d) return "—";
  try {
    return format(new Date(d), "d MMM yyyy");
  } catch {
    return d;
  }
}

export function CleanerInvoicesWorkspace() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Submission["status"]>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Submission | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "void" | "delete"; row: Submission } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cleaner-invoices", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setRows(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  const totals = useMemo(() => {
    const open = rows.filter((r) => r.status === "SUBMITTED");
    return {
      submitted: open.length,
      submittedValue: open.reduce((s, r) => s + Number(r.totalAmount || 0), 0),
      inXero: rows.filter((r) => r.status === "XERO_PUSHED").length,
      paid: rows.filter((r) => r.status === "PAID").length,
    };
  }, [rows]);

  async function patchStatus(id: string, status: Submission["status"], okMsg: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/cleaner-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Action failed", description: body.error, variant: "destructive" });
        return;
      }
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
      toast({ title: okMsg });
    } finally {
      setBusyId(null);
    }
  }

  async function pushXero(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/cleaner-invoices/${id}/xero-push`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Xero push failed", description: body.error, variant: "destructive" });
        return;
      }
      setRows((rs) =>
        rs.map((r) => (r.id === id ? { ...r, status: "XERO_PUSHED", xeroBillId: body.xeroBillId } : r))
      );
      toast({ title: "Pushed to Xero" });
    } finally {
      setBusyId(null);
    }
  }

  async function del(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/cleaner-invoices/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Delete failed", description: body.error, variant: "destructive" });
        return;
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
      toast({ title: "Invoice deleted — the cleaner can resend a corrected one." });
    } finally {
      setBusyId(null);
    }
  }

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "SUBMITTED", label: "Submitted" },
    { key: "XERO_PUSHED", label: "In Xero" },
    { key: "PAID", label: "Paid" },
    { key: "VOID", label: "Reversed" },
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Awaiting action" value={totals.submitted} />
        <EStatCard label="Submitted value" value={money(totals.submittedValue)} />
        <EStatCard label="In Xero" value={totals.inXero} />
        <EStatCard label="Paid" value={totals.paid} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-[0.75rem] font-medium transition-colors ${
                filter === f.key
                  ? "bg-[hsl(var(--e-foreground))] text-[hsl(var(--e-background))]"
                  : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <EButton variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </EButton>
      </div>

      {loading ? (
        <ECard>
          <ECardBody className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading cleaner invoices…
          </ECardBody>
        </ECard>
      ) : filtered.length === 0 ? (
        <EEmptyState
          eyebrow="Cleaner invoices"
          title="Nothing here yet"
          description="When cleaners email an invoice from their portal, it appears here for review and Xero export."
        />
      ) : (
        <ETableShell
          headers={[
            { label: "Cleaner" },
            { label: "Period" },
            { label: "Jobs" },
            { label: "Hours" },
            { label: "Amount" },
            { label: "Status" },
            { label: "", align: "right" },
          ]}
        >
          {filtered.map((r) => {
            const busy = busyId === r.id;
            return (
              <tr key={r.id} className="border-t border-[hsl(var(--e-border))] align-middle">
                <td className="px-4 py-3 text-[0.8125rem] font-medium">{r.cleanerName}</td>
                <td className="px-4 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {fmt(r.periodStart)} – {fmt(r.periodEnd)}
                </td>
                <td className="px-4 py-3 text-[0.8125rem]">{r.jobCount}</td>
                <td className="px-4 py-3 text-[0.8125rem]">{Number(r.hours || 0).toFixed(2)}</td>
                <td className="e-serif px-4 py-3 text-[0.9375rem]">{money(r.totalAmount)}</td>
                <td className="px-4 py-3">
                  <EBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</EBadge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <EButton variant="ghost" size="sm" onClick={() => setDetail(r)} title="View lines">
                      <Eye className="h-4 w-4" />
                    </EButton>
                    {!r.xeroBillId && r.status !== "VOID" ? (
                      <EButton variant="outline" size="sm" disabled={busy} onClick={() => pushXero(r.id)}>
                        <Send className="h-3.5 w-3.5" /> Xero
                      </EButton>
                    ) : null}
                    {r.status === "SUBMITTED" || r.status === "XERO_PUSHED" ? (
                      <EButton variant="outline" size="sm" disabled={busy} onClick={() => patchStatus(r.id, "PAID", "Marked paid")}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                      </EButton>
                    ) : null}
                    {r.status !== "VOID" ? (
                      <EButton variant="outline" size="sm" disabled={busy} onClick={() => setConfirm({ kind: "void", row: r })}>
                        <Undo2 className="h-3.5 w-3.5" /> Reverse
                      </EButton>
                    ) : null}
                    <EButton
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirm({ kind: "delete", row: r })}
                      title="Delete"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />}
                    </EButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </ETableShell>
      )}

      {/* Line detail */}
      {detail ? (
        <EModal open onClose={() => setDetail(null)} size="wide" eyebrow={detail.cleanerName} title={`Invoice · ${fmt(detail.periodStart)} – ${fmt(detail.periodEnd)}`}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-[0.8125rem]">
              <span><span className="text-[hsl(var(--e-muted-foreground))]">Jobs:</span> {detail.jobCount}</span>
              <span><span className="text-[hsl(var(--e-muted-foreground))]">Hours:</span> {Number(detail.hours || 0).toFixed(2)}</span>
              <span><span className="text-[hsl(var(--e-muted-foreground))]">Total:</span> <span className="e-serif">{money(detail.totalAmount)}</span></span>
              <span><span className="text-[hsl(var(--e-muted-foreground))]">Submitted:</span> {fmt(detail.createdAt)}</span>
              {detail.xeroBillId ? <span className="flex items-center gap-1 text-[hsl(var(--e-gold-ink))]"><FileSpreadsheet className="h-3.5 w-3.5" /> Xero {detail.xeroBillId.slice(0, 8)}…</span> : null}
            </div>
            <ETableShell headers={[{ label: "Description" }, { label: "Hours" }, { label: "Rate" }, { label: "Amount", align: "right" }]}>
              {(Array.isArray(detail.lineData?.lines) ? detail.lineData.lines : Array.isArray(detail.lineData) ? detail.lineData : []).map(
                (l: LineRow, i: number) => (
                  <tr key={i} className="border-t border-[hsl(var(--e-border))]">
                    <td className="px-4 py-2 text-[0.8125rem]">{l.description ?? l.label ?? l.jobNumber ?? "Line"}</td>
                    <td className="px-4 py-2 text-[0.8125rem]">{l.hours != null ? Number(l.hours).toFixed(2) : "—"}</td>
                    <td className="px-4 py-2 text-[0.8125rem]">{l.rate != null ? money(l.rate) : "—"}</td>
                    <td className="px-4 py-2 text-right text-[0.8125rem]">{money(l.amount)}</td>
                  </tr>
                )
              )}
            </ETableShell>
            {!(Array.isArray(detail.lineData?.lines) ? detail.lineData.lines.length : Array.isArray(detail.lineData) ? detail.lineData.length : 0) ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No line snapshot stored for this submission.</p>
            ) : null}
          </div>
        </EModal>
      ) : null}

      {/* Reverse / delete confirm */}
      {confirm ? (
        <EConfirmModal
          open
          onClose={() => setConfirm(null)}
          title={confirm.kind === "void" ? "Reverse this invoice?" : "Delete this invoice?"}
          description={
            confirm.kind === "void"
              ? `Mark ${confirm.row.cleanerName}'s invoice (${money(confirm.row.totalAmount)}) as reversed. The cleaner can then resend a corrected invoice.`
              : `Permanently delete ${confirm.row.cleanerName}'s invoice (${money(confirm.row.totalAmount)}). The cleaner can resend a corrected one.${confirm.row.xeroBillId ? " NOTE: this is in Xero and cannot be deleted here — void it in Xero first." : ""}`
          }
          confirmLabel={confirm.kind === "void" ? "Reverse invoice" : "Delete invoice"}
          onConfirm={async () => {
            const row = confirm.row;
            setConfirm(null);
            if (confirm.kind === "void") await patchStatus(row.id, "VOID", "Invoice reversed — the cleaner can resend.");
            else await del(row.id);
          }}
        />
      ) : null}
    </div>
  );
}
