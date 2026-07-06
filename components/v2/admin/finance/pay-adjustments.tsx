"use client";

/**
 * ESTATE pay adjustments — v2-native rebuild of the v1 PayRequestsWorkspace core.
 * Same API surface:
 *   list     → GET    /api/admin/pay-adjustments
 *   review   → PATCH  /api/admin/pay-adjustments/[id]   { status: APPROVED|REJECTED|PENDING, approvedAmount?, adminNote? }
 *   add      → POST   /api/admin/pay-adjustments        { cleanerId, amount, title, note?, jobNumber?, autoApprove? }
 *   delete   → DELETE /api/admin/pay-adjustments/[id]
 * (Send-to-client and deep request editing remain in the classic workspace.)
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { BadgeDollarSign, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

type PayStatus = "PENDING" | "APPROVED" | "REJECTED";

type PayAdjustmentRow = {
  id: string;
  scope: "JOB" | "PROPERTY" | "STANDALONE";
  title: string | null;
  status: PayStatus;
  type: "HOURLY" | "FIXED";
  requestedHours: number | null;
  requestedRate: number | null;
  requestedAmount: number;
  cleanerRequestedAmount?: number;
  clientRequestedAmount?: number | null;
  primaryDisplayAmount?: number;
  approvedAmount: number | null;
  cleanerNote: string | null;
  adminNote: string | null;
  requestedAt: string;
  cleaner: { id: string; name: string | null; email: string };
  job: {
    id: string;
    jobType: string;
    scheduledDate: string;
    property: { id: string; name: string; suburb: string };
  } | null;
  property?: { id: string; name: string; suburb: string | null } | null;
};

type Cleaner = { id: string; name: string | null; email: string };

const STATUS_TONE: Record<PayStatus, "warning" | "success" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const money = (v: number | null | undefined) => `$${Number(v ?? 0).toFixed(2)}`;

function primaryAmount(row: PayAdjustmentRow): number {
  return Number(
    row.primaryDisplayAmount ?? row.clientRequestedAmount ?? row.cleanerRequestedAmount ?? row.requestedAmount ?? 0
  );
}

function dateSafe(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : format(parsed, "dd MMM yyyy");
}

export function EstatePayAdjustments() {
  const [rows, setRows] = useState<PayAdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED" | "ALL">("PENDING");
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);

  // Review modal
  const [reviewing, setReviewing] = useState<PayAdjustmentRow | null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  // Add payment modal
  const [addOpen, setAddOpen] = useState(false);
  const [addCleanerId, setAddCleanerId] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addJobNumber, setAddJobNumber] = useState("");
  const [addAutoApprove, setAddAutoApprove] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

  // Reverse / delete
  const [reverseFor, setReverseFor] = useState<PayAdjustmentRow | null>(null);
  const [reversing, setReversing] = useState(false);
  const [deleteFor, setDeleteFor] = useState<PayAdjustmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pay-adjustments", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setRows(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    fetch("/api/admin/users?role=CLEANER", { cache: "no-store" })
      .then((res) => res.json().catch(() => []))
      .then((body) => setCleaners(Array.isArray(body) ? body : []))
      .catch(() => setCleaners([]));
  }, []);

  const filtered = useMemo(
    () => (tab === "ALL" ? rows : rows.filter((row) => row.status === tab)),
    [rows, tab]
  );
  const pendingCount = useMemo(() => rows.filter((row) => row.status === "PENDING").length, [rows]);

  function openReview(row: PayAdjustmentRow, action: "APPROVED" | "REJECTED") {
    setReviewing(row);
    setReviewAction(action);
    setApprovedAmount(primaryAmount(row).toFixed(2));
    setAdminNote("");
  }

  async function submitReview() {
    if (!reviewing) return;
    if (reviewAction === "APPROVED") {
      const amount = Number(approvedAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "A valid amount greater than zero is required.", variant: "destructive" });
        return;
      }
    }
    setReviewSaving(true);
    try {
      const payload: Record<string, unknown> = {
        status: reviewAction,
        adminNote: adminNote.trim() || undefined,
      };
      if (reviewAction === "APPROVED") payload.approvedAmount = Number(approvedAmount);
      const res = await fetch(`/api/admin/pay-adjustments/${reviewing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not review request.");
      toast({ title: reviewAction === "APPROVED" ? "Request approved" : "Request rejected" });
      setReviewing(null);
      await load();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not review request.", variant: "destructive" });
    } finally {
      setReviewSaving(false);
    }
  }

  async function submitAddPayment() {
    const amount = Number(addAmount);
    if (!addCleanerId) return toast({ title: "Select a cleaner.", variant: "destructive" });
    if (!Number.isFinite(amount) || amount <= 0) return toast({ title: "Enter a valid amount.", variant: "destructive" });
    if (!addTitle.trim()) return toast({ title: "Title is required.", variant: "destructive" });
    setAddSaving(true);
    try {
      const res = await fetch("/api/admin/pay-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId: addCleanerId,
          amount,
          title: addTitle.trim(),
          note: addNote.trim() || undefined,
          jobNumber: addJobNumber.trim() || undefined,
          autoApprove: addAutoApprove,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      toast({ title: addAutoApprove ? "Extra payment added & approved" : "Extra payment added (pending review)" });
      setAddOpen(false);
      setAddCleanerId("");
      setAddTitle("");
      setAddAmount("");
      setAddNote("");
      setAddJobNumber("");
      await load();
    } catch (err: any) {
      toast({ title: "Could not add payment", description: err?.message, variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  }

  async function submitReverse() {
    if (!reverseFor) return;
    setReversing(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${reverseFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not change status.");
      toast({ title: "Request set back to pending" });
      setReverseFor(null);
      await load();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setReversing(false);
    }
  }

  async function submitDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${deleteFor.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete request.");
      toast({ title: "Pay adjustment deleted" });
      setDeleteFor(null);
      await load();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "PENDING", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { id: "APPROVED", label: "Approved" },
    { id: "REJECTED", label: "Rejected" },
    { id: "ALL", label: "All" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={
                "rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
                (tab === t.id
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <EButton variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </EButton>
          <EButton variant="gold" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add payment
          </EButton>
        </div>
      </div>

      {loading ? (
        <ECard className="px-6 py-14 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading pay adjustments…
        </ECard>
      ) : filtered.length === 0 ? (
        <EEmptyState
          eyebrow="Payroll"
          title="Nothing here"
          description={tab === "PENDING" ? "No pay requests are waiting for review." : "No pay adjustments match this filter."}
        />
      ) : (
        <ECard className="overflow-hidden">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {filtered.map((row) => {
              const cleanerName = row.cleaner?.name?.trim() || row.cleaner?.email || "Cleaner";
              const context =
                row.job?.property?.name ??
                row.property?.name ??
                (row.scope === "STANDALONE" ? "Standalone" : "—");
              return (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <BadgeDollarSign className="h-4 w-4 shrink-0 text-[hsl(var(--e-gold))]" />
                      <p className="font-[550]">{row.title || "Pay request"}</p>
                      <EBadge tone={STATUS_TONE[row.status]} soft>{row.status}</EBadge>
                      <EBadge tone="neutral" soft>{row.scope}</EBadge>
                    </div>
                    <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {cleanerName} · {context} · {dateSafe(row.requestedAt)}
                      {row.type === "HOURLY" ? ` · ${row.requestedHours ?? 0}h × ${money(row.requestedRate)}` : ""}
                    </p>
                    {row.cleanerNote ? (
                      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">“{row.cleanerNote}”</p>
                    ) : null}
                    {row.adminNote ? (
                      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">Admin: {row.adminNote}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="e-numeral text-[1.0625rem] leading-none">
                        {money(row.status === "APPROVED" ? row.approvedAmount ?? primaryAmount(row) : primaryAmount(row))}
                      </p>
                      {row.status === "APPROVED" && row.approvedAmount != null && row.approvedAmount !== primaryAmount(row) ? (
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">requested {money(primaryAmount(row))}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.status === "PENDING" ? (
                        <>
                          <EButton size="sm" variant="gold" onClick={() => openReview(row, "APPROVED")}>
                            Approve…
                          </EButton>
                          <EButton size="sm" variant="outline" onClick={() => openReview(row, "REJECTED")}>
                            Reject…
                          </EButton>
                        </>
                      ) : (
                        <EButton size="sm" variant="ghost" onClick={() => setReverseFor(row)}>
                          Reopen
                        </EButton>
                      )}
                      {row.status !== "APPROVED" ? (
                        <EButton
                          size="sm"
                          variant="ghost"
                          className="text-[hsl(var(--e-danger))]"
                          onClick={() => setDeleteFor(row)}
                        >
                          Delete
                        </EButton>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ECard>
      )}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Approved adjustments flow into the next payroll run automatically.
      </p>

      {/* Review */}
      <EModal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        eyebrow="Payroll"
        title={reviewAction === "APPROVED" ? "Approve pay request" : "Reject pay request"}
      >
        <div className="space-y-4">
          {reviewing ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] px-3 py-2.5 text-[0.8125rem]">
              <p className="font-[550]">{reviewing.title || "Pay request"}</p>
              <p className="text-[hsl(var(--e-muted-foreground))]">
                {reviewing.cleaner?.name ?? reviewing.cleaner?.email} · requested {money(primaryAmount(reviewing))}
              </p>
            </div>
          ) : null}
          {reviewAction === "APPROVED" ? (
            <EField label="Approved amount (AUD)" hint="Defaults to the requested amount — adjust if needed.">
              <EInput type="number" min="0" step="0.01" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
            </EField>
          ) : null}
          <EField label="Admin note" hint="Visible to the cleaner alongside the decision.">
            <ETextarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Optional" />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setReviewing(null)} disabled={reviewSaving}>
              Cancel
            </EButton>
            <EButton
              variant={reviewAction === "APPROVED" ? "gold" : "danger"}
              size="sm"
              onClick={submitReview}
              disabled={reviewSaving}
            >
              {reviewSaving ? "Saving…" : reviewAction === "APPROVED" ? "Approve" : "Reject"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Add payment */}
      <EModal open={addOpen} onClose={() => setAddOpen(false)} eyebrow="Payroll" title="Add extra payment">
        <div className="space-y-4">
          <EField label="Cleaner">
            <ESelect value={addCleanerId} onChange={(e) => setAddCleanerId(e.target.value)}>
              <option value="">Select cleaner…</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name?.trim() || c.email}
                </option>
              ))}
            </ESelect>
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Title">
              <EInput value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="e.g. Bond clean bonus" />
            </EField>
            <EField label="Amount (AUD)">
              <EInput type="number" min="0" step="0.01" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} />
            </EField>
          </div>
          <EField label="Job number" hint="Optional — links this payment to a job.">
            <EInput value={addJobNumber} onChange={(e) => setAddJobNumber(e.target.value)} placeholder="JOB-000123" />
          </EField>
          <EField label="Note">
            <ETextarea value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="Optional" />
          </EField>
          <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <div>
              <p className="text-[0.875rem] font-[550]">Auto-approve</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Approve immediately so it lands in the next payroll run.
              </p>
            </div>
            <ESwitch checked={addAutoApprove} onCheckedChange={setAddAutoApprove} />
          </div>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submitAddPayment} disabled={addSaving}>
              {addSaving ? "Adding…" : "Add payment"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Reopen (back to pending) */}
      <EConfirmModal
        open={Boolean(reverseFor)}
        onClose={() => setReverseFor(null)}
        title="Reopen this request?"
        description={
          reverseFor?.status === "APPROVED"
            ? "This sets the request back to pending and removes it from payroll until re-approved."
            : "This sets the request back to pending for another review."
        }
        confirmLabel="Set to pending"
        danger={false}
        loading={reversing}
        onConfirm={submitReverse}
      />

      {/* Delete */}
      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title="Delete this pay adjustment?"
        description="This permanently removes the request."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={submitDelete}
      />
    </div>
  );
}
