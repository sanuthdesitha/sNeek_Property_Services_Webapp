"use client";

/**
 * ESTATE approval centre — the v2-native rebuild of /admin/approvals.
 * One fetch (/api/admin/all-approvals) feeds nine queues; every decision is
 * wired to the SAME mutation endpoint + payload as v1:
 *   timing        PATCH /api/admin/job-early-checkouts/[id]   { status }
 *   pay           PATCH /api/admin/pay-adjustments/[id]       { status, approvedAmount?, adminNote? }
 *   clock         PATCH /api/admin/time-adjustments/[id]      { status, approvedDurationM?, adminNote? }
 *   client        PATCH /api/admin/client-approvals/[id]      { status }
 *   reschedule    PATCH /api/admin/job-tasks/[id]             { decision }
 *   QA rework     PATCH /api/admin/qa/rework-transfers/[id]   { status }
 *   QA outcome    POST  /api/admin/qa/outcomes                { jobIds }
 *   skip          PATCH /api/admin/jobs/[id]/skip             { action }
 * Continuations and flagged laundry are review-and-route queues (links only),
 * exactly as in v1. Presentation is pure Estate; zero v1 component imports.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DollarSign,
  Gift,
  RefreshCw,
  RotateCcw,
  Scale,
  Send,
  ShieldAlert,
  Shirt,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EModal, EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";

/* ── types ─────────────────────────────────────────────────────────────── */
type AllApprovals = {
  continuations: any[];
  timingRequests: any[];
  payAdjustments: any[];
  timeAdjustments: any[];
  clientApprovals: any[];
  flaggedLaundry: any[];
  rescheduleRequests: any[];
  qaReworkTransfers: any[];
  qaOutcomes: any[];
  skipRequests: any[];
  rectificationAdjustments: any[];
  bonusProposals: any[];
  falseConfirmations: any[];
  managementReviews: any[];
  counts: Record<string, number>;
};

const QUEUES = [
  { key: "continuations", label: "Continuations", icon: RefreshCw },
  { key: "timingRequests", label: "Timing", icon: Clock },
  { key: "payAdjustments", label: "Pay requests", icon: DollarSign },
  { key: "timeAdjustments", label: "Clock", icon: Clock },
  { key: "clientApprovals", label: "Client approvals", icon: CheckCircle2 },
  { key: "flaggedLaundry", label: "Laundry", icon: Shirt },
  { key: "rescheduleRequests", label: "Reschedules", icon: CalendarClock },
  { key: "qaReworkTransfers", label: "QA reworks", icon: RotateCcw },
  { key: "qaOutcomes", label: "QA outcomes", icon: ClipboardCheck },
  { key: "skipRequests", label: "Skips", icon: XCircle },
  { key: "rectificationAdjustments", label: "Rectifications", icon: Wrench },
  { key: "bonusProposals", label: "Bonuses", icon: Gift },
  { key: "falseConfirmations", label: "False confirmations", icon: ShieldAlert },
  { key: "managementReviews", label: "Management reviews", icon: Scale },
] as const;

type QueueKey = (typeof QUEUES)[number]["key"];

/* ── helpers ───────────────────────────────────────────────────────────── */
function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd MMM yyyy HH:mm");
  } catch {
    return String(dateStr);
  }
}

function fmtDay(value: string | Date | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "dd MMM yyyy");
}

function minutesLabel(mins?: number | null) {
  if (mins == null || Number.isNaN(mins)) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h <= 0 ? `${m}m` : `${h}h ${m}m`;
}

function primaryPayAmount(row: any): number {
  return Number(
    row.primaryDisplayAmount ??
      row.clientRequestedAmount ??
      row.cleanerRequestedAmount ??
      row.requestedAmount ??
      0
  );
}

const FIELD_CLS =
  "h-9 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

/**
 * Two-step confirm for destructive decisions: first click arms the button
 * ("Confirm …?"), second click within 4s executes. Estate-native, no dialog.
 */
function ConfirmButton({
  label,
  confirmLabel,
  variant = "outline",
  disabled,
  onConfirm,
}: {
  label: React.ReactNode;
  confirmLabel: string;
  variant?: "gold" | "outline" | "danger";
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <EButton
      size="sm"
      variant={armed ? "danger" : variant}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </EButton>
  );
}

/**
 * Escalate a cleaner pay request to the client for approval.
 * Mirrors v1 PayRequestsWorkspace → POST /api/admin/pay-adjustments/[id]/send-to-client
 * { amount, title, description? }. Independent of approve/decline; it does not
 * resolve the row — it surfaces the request in the client portal + notifies them.
 */
function SendToClientForm({
  row,
  defaultAmount,
  onSent,
}: {
  row: any;
  defaultAmount: number;
  onSent: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(
    defaultAmount > 0 ? defaultAmount.toFixed(2) : ""
  );
  const [title, setTitle] = useState(
    row.title ?? row.reason ?? "Additional charge for approval"
  );
  const [description, setDescription] = useState<string>(row.description ?? "");

  const alreadySent = Boolean(row.clientApproval);

  async function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "A valid amount greater than zero is required.", variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: "A title is required.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${row.id}/send-to-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: value,
          title: title.trim(),
          description: description.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not send to client.");
      toast({ title: "Sent to client for approval" });
      setOpen(false);
      await onSent();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not send to client.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (alreadySent) {
    return (
      <EBadge tone="info" soft>
        Awaiting client approval
      </EBadge>
    );
  }

  if (!open) {
    return (
      <EButton size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" />
        Send to client
      </EButton>
    );
  }

  return (
    <div className="mt-3 w-full space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] p-3">
      <p className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">
        Send to client for approval
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <p className="mb-1 text-[0.625rem] text-[hsl(var(--e-text-faint))]">Amount ($)</p>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_CLS + " w-28"}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <p className="mb-1 text-[0.625rem] text-[hsl(var(--e-text-faint))]">Title (shown to client)</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={FIELD_CLS + " w-full"}
          />
        </div>
      </div>
      <div>
        <p className="mb-1 text-[0.625rem] text-[hsl(var(--e-text-faint))]">Description (optional)</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Context the client will see"
          className={
            FIELD_CLS + " h-auto w-full resize-y py-2 leading-snug"
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <EButton size="sm" variant="gold" disabled={busy} onClick={submit}>
          <Send className="h-3.5 w-3.5" />
          {busy ? "Sending…" : "Send"}
        </EButton>
        <EButton size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </EButton>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "PENDING" || status === "REQUESTED"
      ? "warning"
      : status === "APPROVED"
      ? "success"
      : status === "REJECTED" || status === "DECLINED"
      ? "danger"
      : "neutral";
  return (
    <EBadge tone={tone} soft>
      {status}
    </EBadge>
  );
}

/** Standard Estate approval card scaffold: context left, decisions right. */
function QueueCard({
  eyebrow,
  title,
  status,
  lines,
  footer,
  actions,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  status?: React.ReactNode;
  lines?: React.ReactNode[];
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <ECard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <EEyebrow className="text-[0.5625rem]">{eyebrow}</EEyebrow>
          <div className="flex flex-wrap items-center gap-2">
            <p className="e-serif text-[1.0625rem] font-[520] leading-snug">{title}</p>
            {status}
          </div>
          {lines?.map((line, index) =>
            line ? (
              <p key={index} className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {line}
              </p>
            ) : null
          )}
          {footer ? <p className="pt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{footer}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </ECard>
  );
}

function EmptyQueue() {
  return (
    <div className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] px-6 py-14 text-center">
      <EEyebrow>All clear</EEyebrow>
      <p className="e-display-sm mt-1">Nothing awaits your signature</p>
      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No pending items in this queue.</p>
    </div>
  );
}

function severityTone(severity?: string): "danger" | "warning" | "neutral" {
  return severity === "CRITICAL" ? "danger" : severity === "MAJOR" ? "warning" : "neutral";
}

/**
 * Suspected false-completion confirmation. Each decision opens a modal that
 * spells out the score impact before it is committed:
 *   Confirm → keeps the −10 accountability penalty (PATCH { decision:"CONFIRMED" })
 *   Reject  → reverses it                        (PATCH { decision:"REJECTED" })
 */
function FalseConfirmationCard({
  row,
  busy,
  onDecision,
}: {
  row: any;
  busy: boolean;
  onDecision: (decision: "CONFIRMED" | "REJECTED") => void;
}) {
  const [modal, setModal] = useState<null | "CONFIRMED" | "REJECTED">(null);
  const propertyName = row.job?.property?.name ?? row.property?.name ?? "Property";
  return (
    <>
      <QueueCard
        eyebrow="Suspected false confirmation"
        title={<>{row.cleaner?.name ?? row.cleaner?.email ?? "Cleaner"} — {propertyName}</>}
        status={
          <>
            <EBadge tone={severityTone(row.severity)} soft>{row.severity}</EBadge>
            <EBadge tone="aubergine" soft>{row.category}</EBadge>
          </>
        }
        lines={[
          [
            row.job?.property?.suburb ?? row.property?.suburb,
            row.job?.jobNumber ? `Job #${row.job.jobNumber}` : null,
            row.job?.scheduledDate ? fmtDay(row.job.scheduledDate) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          row.description ?? null,
          row.cleanerMarkedComplete ? <>Cleaner marked this item complete.</> : null,
        ]}
        footer={`Raised ${fmt(row.createdAt)}`}
        actions={
          <>
            <EButton size="sm" variant="danger" disabled={busy} onClick={() => setModal("CONFIRMED")}>
              <ShieldAlert className="h-3.5 w-3.5" /> Confirm
            </EButton>
            <EButton size="sm" variant="outline" disabled={busy} onClick={() => setModal("REJECTED")}>
              <XCircle className="h-3.5 w-3.5" /> Reject
            </EButton>
            {row.jobId ? (
              <EButton size="sm" variant="ghost" asChild>
                <Link href={`/v2/admin/jobs/${row.jobId}`}>View job</Link>
              </EButton>
            ) : null}
          </>
        }
      />
      <EModal
        open={modal !== null}
        onClose={() => setModal(null)}
        eyebrow="False confirmation"
        title={modal === "CONFIRMED" ? "Confirm false confirmation" : "Reject false confirmation"}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            {modal === "CONFIRMED"
              ? "Confirming keeps the extra −10 score penalty applied to this clean and marks the false completion as confirmed."
              : "Rejecting reverses the extra −10 score penalty — the cleaner is cleared of a false completion for this item."}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="ghost" size="sm" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </EButton>
            <EButton
              variant={modal === "CONFIRMED" ? "danger" : "gold"}
              size="sm"
              disabled={busy}
              onClick={() => {
                const decision = modal!;
                setModal(null);
                onDecision(decision);
              }}
            >
              {modal === "CONFIRMED" ? "Confirm penalty" : "Reject — reverse penalty"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}

/**
 * QA review routed to management. Links to the job's QA detail and offers an
 * "Adjust score" modal posting to POST /api/admin/jobs/[id]/qa/adjust
 * { reviewId, score, reason } (reason mandatory). Creating a coaching record is
 * deferred — the job link is the entry point for that.
 */
function ManagementReviewCard({
  row,
  busy,
  onAdjusted,
}: {
  row: any;
  busy: boolean;
  onAdjusted: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(row.score != null ? String(row.score) : "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const propertyName = row.job?.property?.name ?? "Property";

  async function submit() {
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast({ title: "Enter a score from 0 to 100", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "A reason is required to adjust the score.", variant: "destructive" });
      return;
    }
    if (!row.jobId) {
      toast({ title: "This review has no linked job.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/jobs/${row.jobId}/qa/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: row.id, score: n, reason: reason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not adjust score.");
      toast({ title: "Score adjusted" });
      setOpen(false);
      await onAdjusted();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not adjust score.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <QueueCard
        eyebrow="Management review"
        title={
          <>
            Job #{row.job?.jobNumber ?? String(row.jobId ?? "").slice(0, 8)}
            {propertyName ? ` — ${propertyName}` : ""}
          </>
        }
        status={<EBadge tone="aubergine" soft>Management review</EBadge>}
        lines={[
          [row.job?.property?.suburb, row.job?.scheduledDate ? fmtDay(row.job.scheduledDate) : null]
            .filter(Boolean)
            .join(" · "),
          <>Cleaner: {row.cleaner?.name ?? "—"}</>,
          <>
            Score: <span className="e-numeral text-[0.9375rem]">{row.score != null ? `${Number(row.score).toFixed(0)}%` : "—"}</span>
            {row.rawScore != null && row.rawScore !== row.score ? (
              <span className="ml-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">raw {Number(row.rawScore).toFixed(0)}%</span>
            ) : null}
          </>,
        ]}
        footer={`Filed ${fmt(row.createdAt)}`}
        actions={
          <>
            <EButton size="sm" variant="gold" disabled={busy} onClick={() => setOpen(true)}>
              <Scale className="h-3.5 w-3.5" /> Adjust score
            </EButton>
            {row.jobId ? (
              <EButton size="sm" variant="outline-gold" asChild>
                <Link href={`/v2/admin/jobs/${row.jobId}`}>
                  QA detail <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </EButton>
            ) : null}
          </>
        }
      />
      <EModal open={open} onClose={() => setOpen(false)} eyebrow="Management review" title="Adjust QA score" size="md">
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Set the final approved score for this clean. A reason is mandatory and recorded on the review.
          </p>
          <EField label="Score (0–100)">
            <EInput
              type="number"
              inputMode="numeric"
              min="0"
              max="100"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </EField>
          <EField label="Reason (required)">
            <ETextarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why the score is being adjusted…"
            />
          </EField>
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="ghost" size="sm" disabled={submitting} onClick={() => setOpen(false)}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" disabled={submitting} onClick={submit}>
              {submitting ? "Saving…" : "Save adjustment"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}

/** Approve/decline an accountability pay adjustment (rectification or bonus). */
function AccountabilityPayCard({
  row,
  eyebrow,
  busy,
  onApprove,
  onDecline,
}: {
  row: any;
  eyebrow: string;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const amount = Number(row.requestedAmount ?? 0);
  const isDeduction = amount < 0 || (row.source ?? "").includes("DEDUCTION");
  return (
    <QueueCard
      eyebrow={eyebrow}
      title={<>{row.cleaner?.name ?? row.cleaner?.email ?? "Cleaner"} — {row.title ?? row.job?.property?.name ?? row.property?.name ?? "Adjustment"}</>}
      status={
        <>
          <StatusPill status={row.status} />
          <EBadge tone={isDeduction ? "danger" : "success"} soft>{String(row.source ?? "").replace(/_/g, " ")}</EBadge>
        </>
      }
      lines={[
        [
          row.job?.property?.suburb ?? row.property?.suburb,
          row.job?.jobNumber ? `Job #${row.job.jobNumber}` : null,
          row.job?.scheduledDate ? fmtDay(row.job.scheduledDate) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        <>
          {isDeduction ? "Deduction" : "Amount"}:{" "}
          <span className="e-numeral text-[0.9375rem]" style={{ color: isDeduction ? "hsl(var(--e-danger))" : undefined }}>
            {isDeduction ? "−" : ""}${Math.abs(amount).toFixed(2)}
          </span>
        </>,
        row.cleanerNote ?? null,
      ]}
      footer={`Requested ${fmt(row.requestedAt ?? row.createdAt)}`}
      actions={
        <>
          <EButton size="sm" variant="gold" disabled={busy} onClick={onApprove}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </EButton>
          <ConfirmButton
            label={<><XCircle className="h-3.5 w-3.5" /> Decline</>}
            confirmLabel="Confirm decline"
            disabled={busy}
            onConfirm={onDecline}
          />
          {row.job?.id ? (
            <EButton size="sm" variant="ghost" asChild>
              <Link href={`/v2/admin/jobs/${row.job.id}`}>View job</Link>
            </EButton>
          ) : null}
        </>
      }
    />
  );
}

/* ── workspace ─────────────────────────────────────────────────────────── */
export function ApprovalsWorkspace() {
  const [data, setData] = useState<AllApprovals | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<QueueKey>("continuations");
  const [acting, setActing] = useState<string | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);

  // Per-row editable decision inputs.
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [payNotes, setPayNotes] = useState<Record<string, string>>({});
  const [clockMinutes, setClockMinutes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/all-approvals", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setData(body);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Land on the first queue that actually has work, once.
  useEffect(() => {
    if (!data || autoSelected) return;
    const first = QUEUES.find((q) => (data.counts[q.key] ?? 0) > 0);
    if (first) setActive(first.key);
    setAutoSelected(true);
  }, [data, autoSelected]);

  /** Optimistically drop a row from its queue, then run the mutation + refresh. */
  async function decide(opts: {
    url: string;
    method?: string;
    body: object;
    queue: QueueKey;
    rowId: string;
    successMsg: string;
  }) {
    const { url, method = "PATCH", body, queue, rowId, successMsg } = opts;
    setActing(rowId);
    const snapshot = data;
    // Optimistic: remove the item locally so the queue feels immediate.
    setData((current) => {
      if (!current) return current;
      const rows = (current as any)[queue] as any[];
      const next = rows.filter((r) => r.id !== rowId);
      return {
        ...current,
        [queue]: next,
        counts: {
          ...current.counts,
          [queue]: Math.max(0, (current.counts[queue] ?? rows.length) - 1),
          total: Math.max(0, (current.counts.total ?? 0) - 1),
        },
      };
    });
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      toast({ title: successMsg });
      await load();
    } catch (err: any) {
      setData(snapshot); // roll back the optimistic removal
      toast({ title: "Failed", description: err?.message ?? "Action failed", variant: "destructive" });
    } finally {
      setActing(null);
    }
  }

  /**
   * Approve QA outcomes: POST /api/admin/qa/outcomes { jobIds } moves each
   * QA_REVIEW job to COMPLETED so it can be invoiced. The endpoint reports
   * per-job results — jobs no longer in QA_REVIEW come back as skipped.
   */
  async function approveQaOutcomes(jobIds: string[]) {
    if (jobIds.length === 0) return;
    setActing(jobIds[0]);
    try {
      const res = await fetch("/api/admin/qa/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Approval failed");
      const approvedCount = Array.isArray(json.approved) ? json.approved.length : 0;
      const skippedCount = Array.isArray(json.skipped) ? json.skipped.length : 0;
      toast({
        title: `${approvedCount} job${approvedCount === 1 ? "" : "s"} marked completed`,
        description: skippedCount > 0 ? `${skippedCount} skipped (no longer awaiting approval).` : undefined,
      });
      await load();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Approval failed", variant: "destructive" });
    } finally {
      setActing(null);
    }
  }

  const total = data?.counts.total ?? 0;
  const busy = Boolean(acting);

  const activeRows = useMemo(() => ((data as any)?.[active] as any[]) ?? [], [data, active]);

  return (
    <div className="space-y-6">
      {/* ── Queue navigation ── */}
      <div className="flex flex-wrap items-center gap-2">
        {QUEUES.map(({ key, label, icon: Icon }) => {
          const count = data?.counts[key] ?? 0;
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={
                "flex items-center gap-2 rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
                (isActive
                  ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                  : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-gold))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
              {count > 0 ? (
                <span
                  className={
                    "e-tnum flex h-5 min-w-5 items-center justify-center rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem] font-[600] " +
                    (isActive
                      ? "bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]"
                      : "bg-[hsl(var(--e-danger-soft))] text-[hsl(var(--e-danger))]")
                  }
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-3">
          {total > 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <span className="e-numeral text-[1.0625rem] text-[hsl(var(--e-foreground))]">{total}</span> pending
            </p>
          ) : null}
          <EButton variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
            Refresh
          </EButton>
        </div>
      </div>

      {/* ── Queue content ── */}
      {loading && !data ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Gathering requests…
        </ECard>
      ) : !data ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-danger))]">
          Failed to load.{" "}
          <button onClick={load} className="underline underline-offset-2">
            Retry
          </button>
        </ECard>
      ) : activeRows.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className="space-y-3">
          {/* ── Continuations (review-and-route, as in v1) ── */}
          {active === "continuations" &&
            activeRows.map((row) => (
              <QueueCard
                key={row.id}
                eyebrow="Job continuation"
                title={
                  <>
                    Job #{row.job?.jobNumber ?? String(row.jobId ?? "").slice(0, 8)}
                    {row.job?.property?.name ? ` — ${row.job.property.name}` : ""}
                  </>
                }
                status={<StatusPill status={row.status} />}
                lines={[
                  [row.job?.property?.suburb, `Scheduled ${fmtDay(row.job?.scheduledDate)}`].filter(Boolean).join(" · "),
                  <>Reason: {row.reason}</>,
                  row.preferredDate ? <>Preferred continuation: {fmtDay(row.preferredDate)}</> : null,
                ]}
                footer={`Requested ${fmt(row.requestedAt)}`}
                actions={
                  <EButton size="sm" variant="outline-gold" asChild>
                    <Link href={`/v2/admin/jobs/${row.jobId}`}>
                      Review job <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </EButton>
                }
              />
            ))}

          {/* ── Timing requests ── */}
          {active === "timingRequests" &&
            activeRows.map((row) => (
              <QueueCard
                key={row.id}
                eyebrow="Timing request"
                title={
                  <>
                    {row.requestType === "EARLY_CHECKIN" ? "Early check-in" : "Late checkout"} —{" "}
                    {row.job?.property?.name ?? `Job #${row.job?.jobNumber ?? String(row.jobId ?? "").slice(0, 8)}`}
                  </>
                }
                status={<StatusPill status={row.status} />}
                lines={[
                  [row.job?.property?.suburb, `Job scheduled ${fmtDay(row.job?.scheduledDate)}`].filter(Boolean).join(" · "),
                  row.requestedTime ? <>Requested time: <span className="e-tnum font-[550]">{row.requestedTime}</span></> : null,
                  row.note ?? null,
                ]}
                footer={`Requested ${fmt(row.requestedAt)}`}
                actions={
                  <>
                    <EButton
                      size="sm"
                      variant="gold"
                      disabled={busy}
                      onClick={() =>
                        decide({
                          url: `/api/admin/job-early-checkouts/${row.id}`,
                          body: { status: "APPROVED" },
                          queue: "timingRequests",
                          rowId: row.id,
                          successMsg: "Timing request approved",
                        })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </EButton>
                    <ConfirmButton
                      label={
                        <>
                          <XCircle className="h-3.5 w-3.5" /> Decline
                        </>
                      }
                      confirmLabel="Confirm decline"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/job-early-checkouts/${row.id}`,
                          body: { status: "DECLINED" },
                          queue: "timingRequests",
                          rowId: row.id,
                          successMsg: "Timing request declined",
                        })
                      }
                    />
                    <EButton size="sm" variant="ghost" asChild>
                      <Link href={`/v2/admin/jobs/${row.jobId}`}>View job</Link>
                    </EButton>
                  </>
                }
              />
            ))}

          {/* ── Pay requests ── */}
          {active === "payAdjustments" &&
            activeRows.map((row) => {
              const amount = payAmounts[row.id] ?? primaryPayAmount(row).toFixed(2);
              const note = payNotes[row.id] ?? "";
              const awaitingClient = row.clientApproval && row.clientApproval.status === "PENDING";
              return (
                <QueueCard
                  key={row.id}
                  eyebrow="Pay request"
                  title={
                    <>
                      {row.cleaner?.name ?? row.cleaner?.email ?? "Cleaner"} —{" "}
                      {row.job?.property?.name ?? row.property?.name ?? row.title ?? "Adjustment"}
                    </>
                  }
                  status={
                    <>
                      <StatusPill status={row.status} />
                      {awaitingClient ? <EBadge tone="info" soft>Awaiting client</EBadge> : null}
                    </>
                  }
                  lines={[
                    [
                      row.job?.property?.suburb ?? row.property?.suburb,
                      row.job?.jobNumber ? `Job #${row.job.jobNumber}` : null,
                      row.job?.scheduledDate ? fmtDay(row.job.scheduledDate) : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    <>
                      Requested:{" "}
                      <span className="e-numeral text-[0.9375rem]">${primaryPayAmount(row).toFixed(2)}</span>
                      {row.requestedHours != null ? ` (${row.requestedHours}h @ $${Number(row.requestedRate ?? 0).toFixed(2)})` : ""}
                    </>,
                    row.cleanerNote ?? row.reason ?? null,
                  ]}
                  footer={`Requested ${fmt(row.requestedAt ?? row.createdAt)}`}
                  actions={
                    <EButton size="sm" variant="ghost" asChild>
                      <Link href={row.jobId ? `/v2/admin/jobs/${row.jobId}` : "/v2/admin/payroll"}>View job</Link>
                    </EButton>
                  }
                >
                  <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                    <div>
                      <p className="mb-1 text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Approve amount ($)</p>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(event) => setPayAmounts((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        className={FIELD_CLS + " w-32"}
                      />
                    </div>
                    <div className="min-w-[180px] flex-1">
                      <p className="mb-1 text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Admin note (optional)</p>
                      <input
                        value={note}
                        onChange={(event) => setPayNotes((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        placeholder="Visible to the cleaner"
                        className={FIELD_CLS + " w-full"}
                      />
                    </div>
                    <EButton
                      size="sm"
                      variant="gold"
                      disabled={busy}
                      onClick={() => {
                        const value = Number(amount);
                        if (!Number.isFinite(value) || value <= 0) {
                          toast({ title: "A valid amount greater than zero is required.", variant: "destructive" });
                          return;
                        }
                        decide({
                          url: `/api/admin/pay-adjustments/${row.id}`,
                          body: { status: "APPROVED", approvedAmount: value, adminNote: note.trim() || undefined },
                          queue: "payAdjustments",
                          rowId: row.id,
                          successMsg: "Pay request approved",
                        });
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </EButton>
                    <ConfirmButton
                      label={
                        <>
                          <XCircle className="h-3.5 w-3.5" /> Decline
                        </>
                      }
                      confirmLabel="Confirm decline"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/pay-adjustments/${row.id}`,
                          body: { status: "REJECTED", adminNote: note.trim() || undefined },
                          queue: "payAdjustments",
                          rowId: row.id,
                          successMsg: "Pay request declined",
                        })
                      }
                    />
                    <SendToClientForm
                      row={row}
                      defaultAmount={primaryPayAmount(row)}
                      onSent={load}
                    />
                  </div>
                </QueueCard>
              );
            })}

          {/* ── Clock adjustments ── */}
          {active === "timeAdjustments" &&
            activeRows.map((row) => {
              const requested = row.requestedDurationM ?? row.requestedTotalDurationM ?? 0;
              const original = row.originalDurationM ?? row.timeLog?.durationM ?? null;
              const minutes = clockMinutes[row.id] ?? String(requested);
              const delta = typeof original === "number" ? requested - original : null;
              return (
                <QueueCard
                  key={row.id}
                  eyebrow="Clock adjustment"
                  title={
                    <>
                      {row.cleaner?.name ?? row.cleaner?.email ?? "Cleaner"} —{" "}
                      {row.job?.property?.name ?? `Job #${row.job?.jobNumber ?? String(row.jobId ?? "").slice(0, 8)}`}
                    </>
                  }
                  status={<StatusPill status={row.status} />}
                  lines={[
                    [
                      row.job?.property?.suburb,
                      row.job?.jobNumber ? `Job #${row.job.jobNumber}` : null,
                      row.job?.scheduledDate ? fmtDay(row.job.scheduledDate) : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    row.reason ?? null,
                  ]}
                  footer={`Requested ${fmt(row.createdAt)}`}
                  actions={
                    <EButton size="sm" variant="ghost" asChild>
                      <Link href={`/v2/admin/jobs/${row.jobId}`}>View job</Link>
                    </EButton>
                  }
                >
                  {/* Before / after ledger */}
                  <div className="mt-4 grid gap-3 border-t border-[hsl(var(--e-border))] pt-4 sm:grid-cols-2">
                    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] p-3">
                      <EEyebrow className="text-[0.5625rem]">Recorded</EEyebrow>
                      <p className="e-numeral mt-1 text-[1.25rem]">{minutesLabel(original)}</p>
                      <p className="e-tnum text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        {fmt(row.timeLog?.startedAt)} → {fmt(row.originalStoppedAt ?? row.timeLog?.stoppedAt)}
                      </p>
                    </div>
                    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft)/0.5)] p-3">
                      <EEyebrow className="text-[0.5625rem]">Requested</EEyebrow>
                      <p className="e-numeral mt-1 text-[1.25rem]">
                        {minutesLabel(requested)}
                        {delta != null && delta !== 0 ? (
                          <span
                            className="ml-2 text-[0.75rem] font-[600]"
                            style={{ color: delta > 0 ? "hsl(var(--e-success))" : "hsl(var(--e-danger))" }}
                          >
                            {delta > 0 ? "+" : "−"}
                            {minutesLabel(Math.abs(delta))}
                          </span>
                        ) : null}
                      </p>
                      <p className="e-tnum text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        {fmt(row.timeLog?.startedAt)} → {fmt(row.requestedStoppedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <p className="mb-1 text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Approve minutes</p>
                      <input
                        type="number"
                        min="1"
                        value={minutes}
                        onChange={(event) => setClockMinutes((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        className={FIELD_CLS + " w-28"}
                      />
                    </div>
                    <EButton
                      size="sm"
                      variant="gold"
                      disabled={busy}
                      onClick={() => {
                        const value = Number(minutes);
                        if (!Number.isFinite(value) || value < 1) {
                          toast({ title: "Enter a valid duration in minutes.", variant: "destructive" });
                          return;
                        }
                        decide({
                          url: `/api/admin/time-adjustments/${row.id}`,
                          body: { status: "APPROVED", approvedDurationM: Math.round(value) },
                          queue: "timeAdjustments",
                          rowId: row.id,
                          successMsg: "Clock adjustment approved",
                        });
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </EButton>
                    <ConfirmButton
                      label={
                        <>
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </>
                      }
                      confirmLabel="Confirm reject"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/time-adjustments/${row.id}`,
                          body: { status: "REJECTED" },
                          queue: "timeAdjustments",
                          rowId: row.id,
                          successMsg: "Clock adjustment rejected",
                        })
                      }
                    />
                  </div>
                </QueueCard>
              );
            })}

          {/* ── Client approvals ── */}
          {active === "clientApprovals" &&
            activeRows.map((row) => (
              <QueueCard
                key={row.id}
                eyebrow="Client approval"
                title={row.title}
                status={<StatusPill status={row.status} />}
                lines={[
                  <>
                    {row.client?.name ?? "Client"}
                    {row.property ? ` · ${row.property.name}` : ""} ·{" "}
                    <span className="e-numeral text-[0.9375rem]">
                      {row.currency} {Number(row.amount ?? 0).toFixed(2)}
                    </span>
                  </>,
                  row.description ?? null,
                ]}
                footer={`Requested ${fmt(row.requestedAt)}${row.expiresAt ? ` · Expires ${fmt(row.expiresAt)}` : ""}`}
                actions={
                  <>
                    <EButton
                      size="sm"
                      variant="gold"
                      disabled={busy}
                      onClick={() =>
                        decide({
                          url: `/api/admin/client-approvals/${row.id}`,
                          body: { status: "APPROVED" },
                          queue: "clientApprovals",
                          rowId: row.id,
                          successMsg: "Approved",
                        })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </EButton>
                    <ConfirmButton
                      label={
                        <>
                          <XCircle className="h-3.5 w-3.5" /> Decline
                        </>
                      }
                      confirmLabel="Confirm decline"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/client-approvals/${row.id}`,
                          body: { status: "DECLINED" },
                          queue: "clientApprovals",
                          rowId: row.id,
                          successMsg: "Declined",
                        })
                      }
                    />
                  </>
                }
              />
            ))}

          {/* ── Flagged laundry (review-and-route, as in v1) ── */}
          {active === "flaggedLaundry" &&
            activeRows.map((row) => (
              <QueueCard
                key={row.id}
                eyebrow="Flagged laundry"
                title={<>Flagged laundry — {row.job?.property?.name ?? "Unknown property"}</>}
                status={<StatusPill status={row.status} />}
                lines={[
                  [
                    row.job?.property?.suburb,
                    row.job?.scheduledDate ? `Job date ${fmtDay(row.job.scheduledDate)}` : null,
                    row.job?.jobNumber ? `Job #${row.job.jobNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  row.bagLocation ? <>Bag location: {row.bagLocation}</> : null,
                  row.notes ?? null,
                ]}
                footer={`Updated ${fmt(row.updatedAt)}`}
                actions={
                  <>
                    <EButton size="sm" variant="outline-gold" asChild>
                      <Link href="/v2/admin/laundry">
                        Open laundry <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </EButton>
                    {row.job?.id ? (
                      <EButton size="sm" variant="ghost" asChild>
                        <Link href={`/v2/admin/jobs/${row.job.id}`}>View job</Link>
                      </EButton>
                    ) : null}
                  </>
                }
              />
            ))}

          {/* ── Reschedule requests ── */}
          {active === "rescheduleRequests" &&
            activeRows.map((row) => {
              const meta = (row.metadata ?? {}) as { requestedDate?: string; requestedStartTime?: string | null };
              return (
                <QueueCard
                  key={row.id}
                  eyebrow="Reschedule request"
                  title={
                    <>
                      Job #{row.job?.jobNumber ?? String(row.jobId ?? "").slice(0, 8)}
                      {row.job?.property?.name ? ` — ${row.job.property.name}` : ""}
                    </>
                  }
                  status={<StatusPill status="PENDING" />}
                  lines={[
                    [
                      row.job?.property?.suburb,
                      `Current ${fmtDay(row.job?.scheduledDate)}${row.job?.startTime ? ` ${row.job.startTime}` : ""}`,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    meta.requestedDate ? (
                      <>
                        Requested:{" "}
                        <span className="e-tnum font-[550]">
                          {fmtDay(meta.requestedDate)}
                          {meta.requestedStartTime ? ` at ${meta.requestedStartTime}` : ""}
                        </span>
                      </>
                    ) : null,
                    <>Requested by {row.requestedBy?.name ?? row.requestedBy?.email ?? "Client"}</>,
                  ]}
                  footer={`Submitted ${fmt(row.createdAt)}`}
                  actions={
                    <>
                      <EButton
                        size="sm"
                        variant="gold"
                        disabled={busy}
                        onClick={() =>
                          decide({
                            url: `/api/admin/job-tasks/${row.id}`,
                            body: { decision: "APPROVE" },
                            queue: "rescheduleRequests",
                            rowId: row.id,
                            successMsg: "Reschedule approved — job date updated",
                          })
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve
                      </EButton>
                      <ConfirmButton
                        label={
                          <>
                            <XCircle className="h-3.5 w-3.5" /> Decline
                          </>
                        }
                        confirmLabel="Confirm decline"
                        disabled={busy}
                        onConfirm={() =>
                          decide({
                            url: `/api/admin/job-tasks/${row.id}`,
                            body: { decision: "REJECT" },
                            queue: "rescheduleRequests",
                            rowId: row.id,
                            successMsg: "Reschedule declined",
                          })
                        }
                      />
                      {row.jobId ? (
                        <EButton size="sm" variant="ghost" asChild>
                          <Link href={`/v2/admin/jobs/${row.jobId}`}>View job</Link>
                        </EButton>
                      ) : null}
                    </>
                  }
                />
              );
            })}

          {/* ── QA rework transfers ── */}
          {active === "qaReworkTransfers" &&
            activeRows.map((row) => (
              <QueueCard
                key={row.id}
                eyebrow="QA rework"
                title={
                  <>
                    {row.job?.property?.name ?? `Job #${row.job?.jobNumber ?? String(row.jobId ?? "").slice(0, 8)}`}
                  </>
                }
                status={
                  <>
                    <StatusPill status={row.status} />
                    {row.severity ? <EBadge tone="aubergine" soft>{row.severity}</EBadge> : null}
                  </>
                }
                lines={[
                  [row.job?.property?.suburb, row.job?.scheduledDate ? fmtDay(row.job.scheduledDate) : null]
                    .filter(Boolean)
                    .join(" · "),
                  <>
                    {row.cleaner?.name ?? "Cleaner"} → {row.qaUser?.name ?? "QA inspector"}
                  </>,
                  <>
                    Proposed transfer: <span className="e-tnum font-[550]">{row.minutesFromCleaner} min</span> ·{" "}
                    <span className="e-numeral text-[0.9375rem]">${Number(row.amountFromCleaner ?? 0).toFixed(2)}</span>
                    {row.affectsCleanerStats ? " · affects cleaner stats" : ""}
                  </>,
                  row.reason ?? null,
                  Array.isArray(row.areas) && row.areas.length > 0 ? <>Areas: {row.areas.join(", ")}</> : null,
                ]}
                footer={`Filed ${fmt(row.createdAt)}`}
                actions={
                  <>
                    <EButton
                      size="sm"
                      variant="gold"
                      disabled={busy}
                      onClick={() =>
                        decide({
                          url: `/api/admin/qa/rework-transfers/${row.id}`,
                          body: { status: "APPROVED" },
                          queue: "qaReworkTransfers",
                          rowId: row.id,
                          successMsg: "Rework approved — time and pay moved to QA",
                        })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </EButton>
                    <ConfirmButton
                      label={
                        <>
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </>
                      }
                      confirmLabel="Confirm reject"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/qa/rework-transfers/${row.id}`,
                          body: { status: "REJECTED" },
                          queue: "qaReworkTransfers",
                          rowId: row.id,
                          successMsg: "Rework rejected",
                        })
                      }
                    />
                    {row.jobId ? (
                      <EButton size="sm" variant="ghost" asChild>
                        <Link href={`/v2/admin/jobs/${row.jobId}`}>View job</Link>
                      </EButton>
                    ) : null}
                  </>
                }
              />
            ))}

          {/* ── QA outcomes (failed inspections parked in QA_REVIEW → COMPLETED) ── */}
          {active === "qaOutcomes" && (
            <>
              {activeRows.length > 0 ? (
                <div className="flex justify-end">
                  <EButton
                    size="sm"
                    variant="gold"
                    disabled={busy}
                    onClick={() => {
                      const n = activeRows.length;
                      if (
                        window.confirm(
                          `Marks ${n} job${n === 1 ? "" : "s"} as completed so they can be invoiced. QA scores and any rework jobs are unaffected.`
                        )
                      ) {
                        approveQaOutcomes(activeRows.map((row) => row.id));
                      }
                    }}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    Approve all ({activeRows.length})
                  </EButton>
                </div>
              ) : null}
              {activeRows.map((row) => (
                <QueueCard
                  key={row.id}
                  eyebrow="QA outcome"
                  title={<>{row.property?.name ?? `Job #${row.jobNumber}`}</>}
                  status={
                    <>
                      {row.review ? (
                        <EBadge tone={row.review.passed ? "success" : "danger"} soft>
                          {row.review.passed ? "Passed" : "Failed"}
                        </EBadge>
                      ) : null}
                      {row.review ? (
                        <EBadge tone="aubergine" soft>
                          {row.review.kind === "QA" ? "Inspection" : "Admin score"}
                        </EBadge>
                      ) : null}
                      {row.review?.cleanerAcknowledgedAt ? (
                        <EBadge tone="info" soft>
                          Seen by cleaner
                        </EBadge>
                      ) : null}
                      {row.openRework ? (
                        <EBadge tone="warning" soft>
                          Rework in progress
                        </EBadge>
                      ) : null}
                    </>
                  }
                  lines={[
                    [row.property?.suburb, `Job #${row.jobNumber}`, fmtDay(row.scheduledDate)]
                      .filter(Boolean)
                      .join(" · "),
                    <>Cleaner: {row.cleaners?.length ? row.cleaners.join(", ") : "—"}</>,
                    row.review ? (
                      <>
                        Score:{" "}
                        <span className="e-numeral text-[0.9375rem]">
                          {Number(row.review.score).toFixed(0)}%
                        </span>
                      </>
                    ) : null,
                  ]}
                  footer={row.review ? `Scored ${fmt(row.review.createdAt)}` : undefined}
                  actions={
                    <>
                      <EButton
                        size="sm"
                        variant="gold"
                        disabled={busy}
                        onClick={() => approveQaOutcomes([row.id])}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve — mark completed
                      </EButton>
                      <EButton size="sm" variant="ghost" asChild>
                        <Link href={`/v2/admin/jobs/${row.id}`}>View job</Link>
                      </EButton>
                    </>
                  }
                />
              ))}
            </>
          )}

          {/* ── Skip requests (approving cancels the clean → confirm both) ── */}
          {active === "skipRequests" &&
            activeRows.map((row) => (
              <QueueCard
                key={row.id}
                eyebrow="Skip request"
                title={<>Skip clean — {row.property?.name ?? `Job #${row.jobNumber ?? String(row.id).slice(0, 8)}`}</>}
                status={<StatusPill status="REQUESTED" />}
                lines={[
                  [
                    row.property?.suburb,
                    `Scheduled ${fmtDay(row.scheduledDate)}${row.startTime ? ` ${row.startTime}` : ""}`,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  row.cleanSkipReason ? <>Reason: {row.cleanSkipReason}</> : null,
                  <>Requested by {row.requestedBy?.name ?? row.requestedBy?.email ?? "Client"}</>,
                ]}
                footer={`Requested ${fmt(row.cleanSkipAt)}`}
                actions={
                  <>
                    <ConfirmButton
                      label={
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve skip
                        </>
                      }
                      confirmLabel="Confirm — cancel clean"
                      variant="gold"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/jobs/${row.id}/skip`,
                          body: { action: "approve" },
                          queue: "skipRequests",
                          rowId: row.id,
                          successMsg: "Skip approved — clean cancelled",
                        })
                      }
                    />
                    <ConfirmButton
                      label={
                        <>
                          <XCircle className="h-3.5 w-3.5" /> Decline
                        </>
                      }
                      confirmLabel="Confirm decline"
                      disabled={busy}
                      onConfirm={() =>
                        decide({
                          url: `/api/admin/jobs/${row.id}/skip`,
                          body: { action: "decline" },
                          queue: "skipRequests",
                          rowId: row.id,
                          successMsg: "Skip declined",
                        })
                      }
                    />
                    <EButton size="sm" variant="ghost" asChild>
                      <Link href={`/v2/admin/jobs/${row.id}`}>View job</Link>
                    </EButton>
                  </>
                }
              />
            ))}

          {/* ── Rectification adjustments (accountability pay/deductions) ── */}
          {active === "rectificationAdjustments" &&
            activeRows.map((row) => (
              <AccountabilityPayCard
                key={row.id}
                row={row}
                eyebrow="Rectification adjustment"
                busy={busy}
                onApprove={() =>
                  decide({
                    url: `/api/admin/pay-adjustments/${row.id}`,
                    body: { status: "APPROVED" },
                    queue: "rectificationAdjustments",
                    rowId: row.id,
                    successMsg: "Rectification adjustment approved",
                  })
                }
                onDecline={() =>
                  decide({
                    url: `/api/admin/pay-adjustments/${row.id}`,
                    body: { status: "REJECTED" },
                    queue: "rectificationAdjustments",
                    rowId: row.id,
                    successMsg: "Rectification adjustment declined",
                  })
                }
              />
            ))}

          {/* ── Bonus proposals (streak / monthly rank) ── */}
          {active === "bonusProposals" &&
            activeRows.map((row) => (
              <AccountabilityPayCard
                key={row.id}
                row={row}
                eyebrow="Bonus proposal"
                busy={busy}
                onApprove={() =>
                  decide({
                    url: `/api/admin/pay-adjustments/${row.id}`,
                    body: { status: "APPROVED" },
                    queue: "bonusProposals",
                    rowId: row.id,
                    successMsg: "Bonus approved",
                  })
                }
                onDecline={() =>
                  decide({
                    url: `/api/admin/pay-adjustments/${row.id}`,
                    body: { status: "REJECTED" },
                    queue: "bonusProposals",
                    rowId: row.id,
                    successMsg: "Bonus declined",
                  })
                }
              />
            ))}

          {/* ── Suspected false confirmations ── */}
          {active === "falseConfirmations" &&
            activeRows.map((row) => (
              <FalseConfirmationCard
                key={row.id}
                row={row}
                busy={busy}
                onDecision={(decision) =>
                  decide({
                    url: `/api/admin/qa/issues/${row.id}`,
                    body: { action: "falseConfirmation", decision },
                    queue: "falseConfirmations",
                    rowId: row.id,
                    successMsg:
                      decision === "CONFIRMED"
                        ? "False confirmation confirmed — penalty kept"
                        : "False confirmation rejected — penalty reversed",
                  })
                }
              />
            ))}

          {/* ── Management reviews ── */}
          {active === "managementReviews" &&
            activeRows.map((row) => (
              <ManagementReviewCard key={row.id} row={row} busy={busy} onAdjusted={load} />
            ))}
        </div>
      )}
    </div>
  );
}
