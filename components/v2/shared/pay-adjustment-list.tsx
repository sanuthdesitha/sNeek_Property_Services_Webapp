"use client";

/**
 * SHARED pay-adjustment display + edit list (pay-transparency wave, 2026-07).
 *
 * Renders the canonical summary's adjustments (lib/finance/job-pay-summary.ts
 * `JobPaySummaryAdjustment`) identically on every surface: signed amount with
 * tone (deduction red / addition green), origin badge (Automatic — … / Manual),
 * status chip, settled chip, what-changed line, timestamps.
 *
 * UNIVERSAL RULE: wherever an adjustment is visible it is either editable right
 * here (admin + not settled → Edit → the ONE mutation endpoint,
 * PATCH /api/admin/pay-adjustments/:id) or navigable to the editable source.
 * A settled row is immutable — the component explains why and offers "Raise
 * correcting adjustment" (POST /api/admin/pay-adjustments with correctionOfId).
 *
 * NO money derivation happens here — every amount/label arrives pre-computed
 * from the lib. After a successful edit the component calls `onChanged` so the
 * mounting surface refetches and every mounted instance shows the same truth.
 */
import * as React from "react";
import Link from "next/link";
import { Loader2, Pencil, PlusCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import {
  describeAdjustment,
  type JobPaySummaryAdjustment,
  type JobPaySummaryAdjustmentInput,
  type PayAdjustmentAudience,
} from "@/lib/finance/job-pay-summary";

export type PayAdjustmentListItem = JobPaySummaryAdjustment;

/** Map a raw CleanerPayAdjustment-shaped API row into the shared item shape
 *  (used by surfaces whose endpoint returns DB rows, e.g. the Approval Center).
 *
 *  `audience` is required and forwarded to `describeAdjustment` — a payee-facing
 *  surface must pass "self" so the admin's private decision note is left out of
 *  the rendered reason. */
export function toPayAdjustmentListItem(row: {
  id: string;
  cleanerId?: string;
  status: string;
  requestedAmount?: number | null;
  approvedAmount?: number | null;
  title?: string | null;
  cleanerNote?: string | null;
  adminNote?: string | null;
  decisionMessage?: string | null;
  source?: string | null;
  sourceKey?: string | null;
  requestedAt?: string | Date | null;
  reviewedAt?: string | Date | null;
  reviewedBy?: { name?: string | null; email?: string | null } | null;
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
  includedInCleanerInvoiceAt?: string | Date | null;
}, audience: PayAdjustmentAudience): PayAdjustmentListItem {
  const input: JobPaySummaryAdjustmentInput = {
    id: row.id,
    cleanerId: row.cleanerId ?? "",
    status: row.status,
    requestedAmount: row.requestedAmount,
    approvedAmount: row.approvedAmount,
    title: row.title,
    cleanerNote: row.cleanerNote,
    adminNote: row.adminNote,
    decisionMessage: row.decisionMessage,
    source: row.source,
    sourceKey: row.sourceKey,
    requestedAt: row.requestedAt ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewedByName: row.reviewedBy?.name ?? row.reviewedBy?.email ?? null,
    includedInPayrollRunId: row.includedInPayrollRunId ?? null,
    includedInCleanerInvoiceId: row.includedInCleanerInvoiceId ?? null,
    includedInCleanerInvoiceAt: row.includedInCleanerInvoiceAt ?? null,
  };
  return describeAdjustment(input, audience);
}

function fmtMoney(amount: number): string {
  const sign = amount < 0 ? "−" : "+";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "PENDING") return "warning";
  return "neutral";
}

function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function settledLabel(item: PayAdjustmentListItem): string | null {
  if (!item.settled) return null;
  return item.settled.rail === "PAYROLL"
    ? `Paid · pay run ${item.settled.id.slice(0, 6)}`
    : "Paid · invoice";
}

export const SETTLED_EXPLANATION =
  "Settled money is immutable — it was paid by a payroll run or billed on an invoice. Raise a correcting adjustment instead.";

/** Display-only body for one adjustment — reused by the Approval Center cards
 *  so what-changed / origin / settled read identically everywhere. */
export function PayAdjustmentDisplay({
  item,
  dense = false,
}: {
  item: PayAdjustmentListItem;
  dense?: boolean;
}) {
  const settled = settledLabel(item);
  const isDeduction = item.amount < 0;
  const decided = fmtDate(item.decidedAt);
  const created = fmtDate(item.createdAt);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="e-numeral text-[0.9375rem] font-[600]"
          style={{
            color: isDeduction
              ? "hsl(var(--e-danger))"
              : item.amount > 0
                ? "hsl(var(--e-success))"
                : undefined,
          }}
        >
          {fmtMoney(item.amount)}
        </span>
        <span className="text-[0.875rem] font-[550]">{item.title}</span>
        <EBadge tone={item.origin === "AUTOMATIC" ? "info" : "neutral"} soft>
          {item.originLabel}
        </EBadge>
        <EBadge tone={statusTone(item.status)} soft>
          {statusLabel(item.status)}
        </EBadge>
        {settled ? (
          <EBadge tone="success" soft>
            {settled}
          </EBadge>
        ) : null}
      </div>
      {!dense ? (
        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {isDeduction ? "Deducts" : "Adds"} ${Math.abs(item.amount).toFixed(2)}
          {item.status !== "APPROVED" ? ` if approved` : ""}
          {created ? ` · raised ${created}` : ""}
          {decided
            ? ` · ${item.status === "PENDING" ? "updated" : statusLabel(item.status).toLowerCase()} ${decided}${
                item.decidedBy ? ` by ${item.decidedBy}` : ""
              }`
            : ""}
        </p>
      ) : null}
      {item.reason ? (
        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{item.reason}</p>
      ) : null}
    </div>
  );
}

interface EditState {
  item: PayAdjustmentListItem;
  mode: "edit" | "correct";
}

export function PayAdjustmentList({
  items,
  variant,
  payeeId,
  onChanged,
  detailsHref,
  historyHref = "/v2/admin/approvals",
  emptyText,
}: {
  items: PayAdjustmentListItem[];
  /** "admin" = editable in place; "self" = read-only with a details link. */
  variant: "admin" | "self";
  /** Payee the "Raise correcting adjustment" POST targets (admin variant). */
  payeeId?: string;
  /** Called after ANY successful mutation so the surface refetches truth. */
  onChanged?: () => void | Promise<void>;
  /** Self variant: where "View details" points (their pay/pay-requests page). */
  detailsHref?: string;
  /** Where the Approval Center decision history lives. */
  historyHref?: string;
  emptyText?: string;
}) {
  const [dialog, setDialog] = React.useState<EditState | null>(null);

  if (items.length === 0) {
    return emptyText ? (
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{emptyText}</p>
    ) : null;
  }

  return (
    <div className="divide-y divide-[hsl(var(--e-border))]">
      {items.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <PayAdjustmentDisplay item={item} />
          <div className="flex shrink-0 flex-col items-end gap-1">
            {variant === "admin" ? (
              item.editable ? (
                <EButton
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ item, mode: "edit" })}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </EButton>
              ) : (
                <>
                  <span
                    title={SETTLED_EXPLANATION}
                    className="cursor-help text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"
                  >
                    Settled — locked
                  </span>
                  <EButton
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog({ item, mode: "correct" })}
                  >
                    <PlusCircle className="h-3.5 w-3.5" /> Raise correcting adjustment
                  </EButton>
                  <Link
                    href={historyHref}
                    className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))] underline-offset-2 hover:underline"
                  >
                    View decision history
                  </Link>
                </>
              )
            ) : detailsHref ? (
              <Link
                href={detailsHref}
                className="text-[0.75rem] font-[550] underline-offset-2 hover:underline"
              >
                View details
              </Link>
            ) : null}
          </div>
        </div>
      ))}

      {dialog ? (
        <PayAdjustmentEditDialog
          state={dialog}
          payeeId={payeeId}
          onClose={() => setDialog(null)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

/* ── Edit / correct dialog — always the ONE mutation path ──────────────── */

function PayAdjustmentEditDialog({
  state,
  payeeId,
  onClose,
  onChanged,
}: {
  state: EditState;
  payeeId?: string;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}) {
  const { item, mode } = state;
  const isDeduction = item.amount < 0;
  const [amount, setAmount] = React.useState(Math.abs(item.amount || 0).toFixed(2));
  const [note, setNote] = React.useState("");
  /** Private admin note — deliberately separate from the payee message. */
  const [privateNote, setPrivateNote] = React.useState("");
  const [direction, setDirection] = React.useState<"ADDITION" | "DEDUCTION">(
    // A correction of an over-payment defaults to the OPPOSITE direction.
    mode === "correct" ? (isDeduction ? "ADDITION" : "DEDUCTION") : isDeduction ? "DEDUCTION" : "ADDITION"
  );
  const [busy, setBusy] = React.useState(false);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.status === 409) {
        throw new Error(payload.error ?? "This was just settled — refresh and raise a correcting adjustment.");
      }
      if (!res.ok) throw new Error(payload.error ?? "Could not update the adjustment.");
      toast({ title: successMsg });
      onClose();
      await onChanged?.();
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err?.message ?? "Could not update the adjustment.",
        variant: "destructive",
      });
      // Rollback = refetch truth, so the optimistic UI can't drift.
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function raiseCorrection() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "Enter a valid amount greater than zero.", variant: "destructive" });
      return;
    }
    if (!payeeId) {
      toast({ title: "Missing payee for the correction.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId: payeeId,
          amount: value,
          direction,
          title: `Correction — ${item.title}`.slice(0, 160),
          note:
            (note.trim() ? `${note.trim()} ` : "") +
            `(corrects settled adjustment ${item.id})`,
          autoApprove: false,
          correctionOfId: item.id,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not raise the correcting adjustment.");
      toast({
        title: "Correcting adjustment raised",
        description: "It is pending in the Approval Center pay queue.",
      });
      onClose();
      await onChanged?.();
    } catch (err: any) {
      toast({
        title: "Could not raise correction",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem]";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 shadow-xl">
        <p className="text-[0.9375rem] font-[600]">
          {mode === "correct" ? "Raise correcting adjustment" : "Edit adjustment"}
        </p>
        <div className="mt-2">
          <PayAdjustmentDisplay item={item} dense />
        </div>

        {mode === "correct" ? (
          <div className="mt-3 space-y-3">
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{SETTLED_EXPLANATION}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[0.75rem] font-[550]">
                Direction
                <select
                  className={inputCls + " mt-1"}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "ADDITION" | "DEDUCTION")}
                >
                  <option value="ADDITION">Addition (pay more)</option>
                  <option value="DEDUCTION">Deduction (pay less)</option>
                </select>
              </label>
              <label className="text-[0.75rem] font-[550]">
                Amount ($)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputCls + " mt-1"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            <label className="block text-[0.75rem] font-[550]">
              Note (why this corrects the original)
              <textarea
                className={inputCls + " mt-1 min-h-[3.5rem]"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Original deduction was $20 too high."
              />
            </label>
            <div className="flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </EButton>
              <EButton variant="gold" size="sm" onClick={raiseCorrection} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Raise correction
              </EButton>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {isDeduction ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Deduction amounts come from the source system (QA/rework decision). Approve or
                reject it here; to change the amount, reverse the source decision or raise a
                correcting adjustment once settled.
              </p>
            ) : (
              <label className="block text-[0.75rem] font-[550]">
                Amount ($)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputCls + " mt-1"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            {/* This box was labelled "Admin note (visible to the payee)" but
                wrote `adminNote`, which is private — so an admin writing here
                believed they were talking to the cleaner while the text went
                nowhere the cleaner could see, and separately leaked through
                three other paths. The box now writes `decisionMessage`, which
                is what the label always promised. */}
            <label className="block text-[0.75rem] font-[550]">
              Message to the payee
              <textarea
                className={inputCls + " mt-1 min-h-[3.5rem]"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explain the decision — they will read this."
              />
            </label>
            <label className="block text-[0.75rem] font-[550]">
              Private note (admin only)
              <textarea
                className={inputCls + " mt-1 min-h-[3rem]"}
                value={privateNote}
                onChange={(e) => setPrivateNote(e.target.value)}
                placeholder="Optional — never shown to the payee."
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </EButton>
              {item.status !== "PENDING" ? (
                <EButton
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => patch({ status: "PENDING", decisionMessage: note.trim() || undefined, adminNote: privateNote.trim() || undefined }, "Adjustment reopened")}
                >
                  Reopen (back to pending)
                </EButton>
              ) : null}
              {item.status !== "REJECTED" ? (
                <EButton
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => patch({ status: "REJECTED", decisionMessage: note.trim() || undefined, adminNote: privateNote.trim() || undefined }, "Adjustment rejected")}
                >
                  Reject
                </EButton>
              ) : null}
              {item.status === "APPROVED" && !isDeduction ? (
                <EButton
                  variant="gold"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const value = Number(amount);
                    if (!Number.isFinite(value) || value <= 0) {
                      toast({ title: "Enter a valid amount greater than zero.", variant: "destructive" });
                      return;
                    }
                    void patch(
                      { approvedAmount: value, decisionMessage: note.trim() || undefined, adminNote: privateNote.trim() || undefined },
                      "Approved amount updated"
                    );
                  }}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save amount
                </EButton>
              ) : null}
              {item.status !== "APPROVED" ? (
                <EButton
                  variant="gold"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (isDeduction) {
                      void patch({ status: "APPROVED", decisionMessage: note.trim() || undefined, adminNote: privateNote.trim() || undefined }, "Adjustment approved");
                      return;
                    }
                    const value = Number(amount);
                    if (!Number.isFinite(value) || value <= 0) {
                      toast({ title: "Enter a valid amount greater than zero.", variant: "destructive" });
                      return;
                    }
                    void patch(
                      { status: "APPROVED", approvedAmount: value, decisionMessage: note.trim() || undefined, adminNote: privateNote.trim() || undefined },
                      "Adjustment approved"
                    );
                  }}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Approve
                </EButton>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
