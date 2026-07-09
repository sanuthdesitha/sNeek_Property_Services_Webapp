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
import {
  ETableShell, EModal, EConfirmModal, EInput, ETextarea, EField, ESelect,
} from "@/components/v2/admin/estate-kit";

const CLEANER_PAY_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "XERO", label: "Xero" },
  { value: "OTHER", label: "Other" },
];
const CLEANER_PAY_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  CLEANER_PAY_METHODS.map((m) => [m.value, m.label]),
);

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
  paidAmount: number | null;
  paidBankAccount: string | null;
  paidNote: string | null;
  paymentMethod: string | null;
  paidDate: string | null;
  paidAt: string | null;
};

/** Best-effort read of the cleaner's bank account from the snapshotted lineData. */
function bankFromLineData(lineData: any): string {
  if (!lineData || typeof lineData !== "object") return "";
  const name = lineData.cleanerBankAccountName;
  const bsb = lineData.cleanerBankBsb;
  const acc = lineData.cleanerBankAccountNumber;
  const parts = [
    typeof name === "string" && name.trim() ? name.trim() : null,
    typeof bsb === "string" && bsb.trim() ? `BSB ${bsb.trim()}` : null,
    typeof acc === "string" && acc.trim() ? `Acc ${acc.trim()}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

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
  const [payFor, setPayFor] = useState<Submission | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payBank, setPayBank] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payMethod, setPayMethod] = useState("BANK_TRANSFER");
  const [payDate, setPayDate] = useState("");

  function openPay(row: Submission) {
    setPayAmount(String(Number(row.totalAmount ?? 0).toFixed(2)));
    setPayBank(bankFromLineData(row.lineData));
    setPayNote("");
    setPayMethod("BANK_TRANSFER");
    setPayDate(format(new Date(), "yyyy-MM-dd"));
    setPayFor(row);
  }

  async function submitPayment() {
    if (!payFor) return;
    const id = payFor.id;
    const amount = Number(payAmount);
    if (payAmount.trim() && (Number.isNaN(amount) || amount < 0)) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/cleaner-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "PAID",
          paidAmount: payAmount.trim() ? amount : undefined,
          paidBankAccount: payBank.trim() || undefined,
          paidNote: payNote.trim() || undefined,
          paymentMethod: payMethod,
          paidDate: payDate ? `${payDate}T00:00:00.000Z` : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not mark paid", description: body.error, variant: "destructive" });
        return;
      }
      const paidAmount = payAmount.trim() ? amount : Number(payFor.totalAmount ?? 0);
      setRows((rs) =>
        rs.map((r) =>
          r.id === id
            ? {
                ...r,
                status: "PAID",
                paidAmount,
                paidBankAccount: payBank.trim() || null,
                paidNote: payNote.trim() || null,
                paymentMethod: payMethod,
                paidDate: payDate ? `${payDate}T00:00:00.000Z` : new Date().toISOString(),
                paidAt: new Date().toISOString(),
              }
            : r
        )
      );
      toast({ title: "Marked paid", description: `${money(paidAmount)} · ${CLEANER_PAY_METHOD_LABEL[payMethod] ?? payMethod}${payBank.trim() ? ` → ${payBank.trim()}` : ""}` });
      setPayFor(null);
    } finally {
      setBusyId(null);
    }
  }

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
                      <EButton variant="outline" size="sm" disabled={busy} onClick={() => openPay(r)}>
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
            {detail.status === "PAID" ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-success)/0.35)] bg-[hsl(var(--e-success)/0.06)] p-3 text-[0.8125rem]">
                <p className="mb-1 font-medium text-[hsl(var(--e-success))]">Payment recorded</p>
                <div className="flex flex-wrap gap-4">
                  <span><span className="text-[hsl(var(--e-muted-foreground))]">Amount paid:</span> <span className="e-serif">{money(detail.paidAmount ?? detail.totalAmount)}</span></span>
                  {detail.paymentMethod ? <span><span className="text-[hsl(var(--e-muted-foreground))]">Method:</span> {CLEANER_PAY_METHOD_LABEL[detail.paymentMethod] ?? detail.paymentMethod}</span> : null}
                  {detail.paidBankAccount ? <span><span className="text-[hsl(var(--e-muted-foreground))]">Bank account:</span> {detail.paidBankAccount}</span> : null}
                  {detail.paidDate ? <span><span className="text-[hsl(var(--e-muted-foreground))]">Paid on:</span> {fmt(detail.paidDate)}</span> : null}
                  {detail.paidAt ? <span><span className="text-[hsl(var(--e-muted-foreground))]">Recorded:</span> {fmt(detail.paidAt)}</span> : null}
                </div>
                {detail.paidNote ? <p className="mt-1.5 text-[hsl(var(--e-muted-foreground))]"><span className="text-[hsl(var(--e-foreground))]">Comments:</span> {detail.paidNote}</p> : null}
              </div>
            ) : null}
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

      {/* Mark paid — capture amount, bank account + comments */}
      {payFor ? (
        <EModal
          open
          onClose={() => setPayFor(null)}
          size="md"
          eyebrow={payFor.cleanerName}
          title="Record payment"
        >
          <div className="space-y-4">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Invoice total {money(payFor.totalAmount)} · {fmt(payFor.periodStart)} – {fmt(payFor.periodEnd)}
            </p>
            <EField label="Amount paid" hint="Defaults to the invoice total — edit if you paid a different amount.">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">$</span>
                <EInput
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="pl-6"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
            </EField>
            <div className="grid grid-cols-2 gap-3">
              <EField label="Payment method">
                <ESelect value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  {CLEANER_PAY_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </ESelect>
              </EField>
              <EField label="Paid date">
                <EInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </EField>
            </div>
            <EField label="Bank account paid to" hint="Which account the money was sent to (prefilled from the cleaner's details when available).">
              <EInput
                value={payBank}
                onChange={(e) => setPayBank(e.target.value)}
                placeholder="e.g. Jane Doe · BSB 062-000 · Acc 1234 5678"
              />
            </EField>
            <EField label="Comments (optional)">
              <ETextarea
                rows={3}
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Reference, part-payment note, etc."
              />
            </EField>
            <div className="flex justify-end gap-2 pt-1">
              <EButton variant="ghost" onClick={() => setPayFor(null)} disabled={busyId === payFor.id}>
                Cancel
              </EButton>
              <EButton variant="gold" onClick={submitPayment} disabled={busyId === payFor.id}>
                {busyId === payFor.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Mark paid
              </EButton>
            </div>
          </div>
        </EModal>
      ) : null}
    </div>
  );
}
