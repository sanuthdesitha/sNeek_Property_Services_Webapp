"use client";

/**
 * ESTATE pay adjustments — v2-native rebuild of the v1 PayRequestsWorkspace core.
 * Same API surface:
 *   list     → GET    /api/admin/pay-adjustments
 *   review   → PATCH  /api/admin/pay-adjustments/[id]   { status: APPROVED|REJECTED|PENDING, approvedAmount?, adminNote? }
 *   edit     → PATCH  /api/admin/pay-adjustments/[id]   { type, title?, adminNote?, requestedAmount? | requestedHours/requestedRate }
 *   link     → PATCH  /api/admin/pay-adjustments/[id]   { title?, propertyId: id|null }
 *   add      → POST   /api/admin/pay-adjustments        { cleanerId, amount, title, note?, jobNumber?, autoApprove? }
 *   delete   → DELETE /api/admin/pay-adjustments/[id]
 *   escalate → POST   /api/admin/pay-adjustments/[id]/send-to-client { amount, title, description?, currency }
 *   recall   → DELETE /api/admin/pay-adjustments/[id]/send-to-client
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { BadgeDollarSign, Link2, Pencil, Plus, RefreshCw, Send, Undo2 } from "lucide-react";
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
  // Latest linked client-approval record (source: pay_adjustment), when the
  // request has been escalated to the client portal.
  clientApproval?: {
    id: string;
    status: "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | string;
    amount?: number;
  } | null;
};

type Cleaner = { id: string; name: string | null; email: string };
type PropertyOption = {
  id: string;
  name: string;
  suburb?: string | null;
  client?: { id: string; name: string } | null;
};

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

  // Edit request (title / amount / hours+rate / note) — same PATCH as v1.
  const [editFor, setEditFor] = useState<PayAdjustmentRow | null>(null);
  const [editType, setEditType] = useState<"FIXED" | "HOURLY">("FIXED");
  const [editTitle, setEditTitle] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Link to property — same PATCH { title?, propertyId } as v1.
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [linkFor, setLinkFor] = useState<PayAdjustmentRow | null>(null);
  const [linkPropertyId, setLinkPropertyId] = useState("__none__");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);

  // Send-to-client escalation + recall.
  const [sendFor, setSendFor] = useState<PayAdjustmentRow | null>(null);
  const [sendAmount, setSendAmount] = useState("");
  const [sendTitle, setSendTitle] = useState("");
  const [sendDescription, setSendDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [recallFor, setRecallFor] = useState<PayAdjustmentRow | null>(null);
  const [recalling, setRecalling] = useState(false);

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

  /* ── Edit request (title / amount / hours+rate / note) ─────────────────── */
  function openEditRequest(row: PayAdjustmentRow) {
    setEditFor(row);
    setEditType(row.type);
    setEditTitle(row.title ?? "");
    setEditHours(row.requestedHours != null ? String(row.requestedHours) : "");
    setEditRate(row.requestedRate != null ? String(row.requestedRate) : "");
    setEditAmount(Number(row.cleanerRequestedAmount ?? row.requestedAmount ?? 0).toFixed(2));
    setEditNote("");
  }

  async function submitEditRequest() {
    if (!editFor) return;
    const payload: Record<string, unknown> = { type: editType };
    if (editTitle.trim()) payload.title = editTitle.trim();
    if (editNote.trim()) payload.adminNote = editNote.trim();
    if (editType === "HOURLY") {
      const hours = Number(editHours || 0);
      const rate = Number(editRate || 0);
      if (!Number.isFinite(hours) || hours <= 0) return toast({ title: "Enter valid hours.", variant: "destructive" });
      if (!Number.isFinite(rate) || rate <= 0) return toast({ title: "Enter a valid rate.", variant: "destructive" });
      payload.requestedHours = hours;
      payload.requestedRate = rate;
    } else {
      const amount = Number(editAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) return toast({ title: "Enter a valid amount.", variant: "destructive" });
      payload.requestedAmount = amount;
      payload.requestedHours = null;
      payload.requestedRate = null;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${editFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update request.");
      toast({ title: "Request updated", description: "The cleaner and client now see the new values." });
      setEditFor(null);
      await load();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  }

  /* ── Link to property ──────────────────────────────────────────────────── */
  async function loadProperties() {
    if (properties.length > 0) return;
    try {
      const res = await fetch("/api/admin/properties", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setProperties(Array.isArray(body) ? body : []);
    } catch {
      setProperties([]);
    }
  }

  function openLinkProperty(row: PayAdjustmentRow) {
    setLinkFor(row);
    setLinkPropertyId(row.property?.id ?? "__none__");
    setLinkTitle(row.title ?? "");
    void loadProperties();
  }

  async function submitLink() {
    if (!linkFor) return;
    setLinkSaving(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${linkFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: linkTitle.trim() || undefined,
          propertyId: linkPropertyId === "__none__" ? null : linkPropertyId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update request.");
      toast({ title: "Request updated" });
      setLinkFor(null);
      await load();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setLinkSaving(false);
    }
  }

  /* ── Send-to-client escalation (client approval) ───────────────────────── */
  function openSendToClient(row: PayAdjustmentRow) {
    setSendFor(row);
    setSendAmount(Number(row.clientRequestedAmount ?? row.requestedAmount ?? 0).toFixed(2));
    setSendTitle(`Additional charge approval - ${row.job?.property?.name ?? row.property?.name ?? "Request"}`);
    setSendDescription(
      row.cleanerNote?.trim()
        ? `Cleaner requested additional payment. Note: ${row.cleanerNote}`
        : "Cleaner requested additional payment."
    );
  }

  async function submitSendToClient() {
    if (!sendFor) return;
    const amount = Number(sendAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return toast({ title: "A valid client amount is required.", variant: "destructive" });
    }
    if (!sendTitle.trim()) return toast({ title: "Title is required.", variant: "destructive" });
    setSending(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${sendFor.id}/send-to-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          title: sendTitle.trim(),
          description: sendDescription.trim(),
          currency: "AUD",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      toast({ title: "Sent to client for approval", description: "It now appears in the client portal." });
      setSendFor(null);
      await load();
    } catch (err: any) {
      toast({ title: "Could not send to client", description: err?.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function submitRecall() {
    if (!recallFor) return;
    setRecalling(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${recallFor.id}/send-to-client`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      toast({ title: "Client approval recalled", description: "The request was removed from the client portal." });
      setRecallFor(null);
      await load();
    } catch (err: any) {
      toast({ title: "Could not recall client approval", description: err?.message, variant: "destructive" });
    } finally {
      setRecalling(false);
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
                      {row.clientApproval?.status === "PENDING" ? (
                        <EBadge tone="info" soft>Awaiting client approval</EBadge>
                      ) : row.clientApproval?.status === "APPROVED" ? (
                        <EBadge tone="success" soft>Client approved</EBadge>
                      ) : row.clientApproval?.status === "DECLINED" ? (
                        <EBadge tone="danger" soft>Client declined</EBadge>
                      ) : row.clientApproval?.status === "EXPIRED" ? (
                        <EBadge tone="neutral" soft>Client approval expired</EBadge>
                      ) : null}
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
                      <EButton size="sm" variant="ghost" onClick={() => openEditRequest(row)} title="Edit the underlying request">
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </EButton>
                      <EButton size="sm" variant="ghost" onClick={() => openLinkProperty(row)} title="Link to a property">
                        <Link2 className="h-3.5 w-3.5" />
                        Link
                      </EButton>
                      {row.clientApproval?.status === "PENDING" ? (
                        <EButton size="sm" variant="ghost" onClick={() => setRecallFor(row)} title="Remove from the client portal">
                          <Undo2 className="h-3.5 w-3.5" />
                          Recall client
                        </EButton>
                      ) : (
                        <EButton size="sm" variant="ghost" onClick={() => openSendToClient(row)} title="Send to the client for approval">
                          <Send className="h-3.5 w-3.5" />
                          Send to client
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

      {/* Edit request (title / amount / hours+rate / note) */}
      <EModal open={Boolean(editFor)} onClose={() => setEditFor(null)} eyebrow="Payroll" title="Edit pay request">
        <div className="space-y-4">
          {editFor ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] px-3 py-2.5 text-[0.8125rem]">
              <p className="font-[550]">{editFor.title || "Pay request"}</p>
              <p className="text-[hsl(var(--e-muted-foreground))]">
                {editFor.cleaner?.name ?? editFor.cleaner?.email} · currently {money(primaryAmount(editFor))}
              </p>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Type">
              <ESelect value={editType} onChange={(e) => setEditType(e.target.value as "FIXED" | "HOURLY")}>
                <option value="FIXED">Fixed amount</option>
                <option value="HOURLY">Hourly (hours × rate)</option>
              </ESelect>
            </EField>
            <EField label="Title">
              <EInput value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="e.g. Extra deep clean" />
            </EField>
          </div>
          {editType === "HOURLY" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Hours">
                <EInput type="number" min="0" step="0.25" value={editHours} onChange={(e) => setEditHours(e.target.value)} />
              </EField>
              <EField label="Rate (AUD/hr)">
                <EInput type="number" min="0" step="0.01" value={editRate} onChange={(e) => setEditRate(e.target.value)} />
              </EField>
            </div>
          ) : (
            <EField label="Requested amount (AUD)">
              <EInput type="number" min="0" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </EField>
          )}
          <EField label="Admin note" hint="Optional — visible to the cleaner alongside the request.">
            <ETextarea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Reason for the change" />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setEditFor(null)} disabled={editSaving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submitEditRequest} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Link to property */}
      <EModal open={Boolean(linkFor)} onClose={() => setLinkFor(null)} eyebrow="Payroll" title="Link to a property">
        <div className="space-y-4">
          <EField
            label="Property"
            hint="A client-linked property is required before this request can be sent to a client."
          >
            <ESelect value={linkPropertyId} onChange={(e) => setLinkPropertyId(e.target.value)}>
              <option value="__none__">No property (standalone)</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.suburb ? ` · ${p.suburb}` : ""}
                  {p.client?.name ? ` — ${p.client.name}` : ""}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Title" hint="Optional — shown to the cleaner and the client.">
            <EInput value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="e.g. Extra deep clean" />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setLinkFor(null)} disabled={linkSaving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submitLink} disabled={linkSaving}>
              {linkSaving ? "Saving…" : "Save link"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Send to client (escalation) */}
      <EModal open={Boolean(sendFor)} onClose={() => setSendFor(null)} eyebrow="Payroll" title="Send to client for approval">
        <div className="space-y-4">
          {sendFor ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] px-3 py-2.5 text-[0.8125rem]">
              <p className="font-[550]">{sendFor.title || "Pay request"}</p>
              <p className="text-[hsl(var(--e-muted-foreground))]">
                {sendFor.cleaner?.name ?? sendFor.cleaner?.email} ·{" "}
                {sendFor.job?.property?.name ?? sendFor.property?.name ?? "No property linked"} · cleaner requested{" "}
                {money(sendFor.cleanerRequestedAmount ?? sendFor.requestedAmount)}
              </p>
            </div>
          ) : null}
          <EField label="Client amount (AUD)" hint="The amount the client is asked to approve — it can differ from the cleaner's request.">
            <EInput type="number" min="0" step="0.01" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} />
          </EField>
          <EField label="Title">
            <EInput value={sendTitle} onChange={(e) => setSendTitle(e.target.value)} />
          </EField>
          <EField label="Description" hint="Shown to the client in their approvals list and email.">
            <ETextarea value={sendDescription} onChange={(e) => setSendDescription(e.target.value)} />
          </EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            This appears in the client portal and notifies the client. While the client approval is
            pending, the cleaner request cannot be approved.
          </p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setSendFor(null)} disabled={sending}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submitSendToClient} disabled={sending}>
              {sending ? "Sending…" : "Send to client"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Recall client approval */}
      <EConfirmModal
        open={Boolean(recallFor)}
        onClose={() => setRecallFor(null)}
        title="Recall this client approval?"
        description="It will be removed from the client portal. You can send it again later if needed."
        confirmLabel="Recall"
        danger={false}
        loading={recalling}
        onConfirm={submitRecall}
      />

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
