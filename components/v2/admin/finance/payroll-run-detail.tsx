"use client";

/**
 * ESTATE payroll run detail — v2-native replacement for the v1 PayrollRunDetail.
 * Same endpoints, new Estate UI (primitives + estate-kit):
 *   GET   /api/admin/payroll/runs/[id]                  → run + payouts
 *   PATCH /api/admin/payroll/runs/[id]                  { status } | { payoutId, payoutStatus }
 *   POST  /api/admin/payroll/runs/[id]/confirm
 *   POST  /api/admin/payroll/runs/[id]/process          → { successCount, failCount }
 *   POST  /api/admin/payroll/runs/[id]/aba              → ABA file (download)
 */

import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { ESelect } from "@/components/v2/admin/estate-kit";

type Payout = {
  id: string;
  cleanerId: string;
  cleanerName: string | null;
  cleanerEmail: string;
  amount: number;
  shoppingReimbursement: number;
  transportAllowance: number;
  adjustments: number;
  status: string;
  method: string;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  stripeAccountId: string | null;
  failureReason: string | null;
};

type PayrollRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalPayable: number;
  totalShoppingReimbursements: number;
  totalTransportAllowances: number;
  totalAdjustments: number;
  grandTotal: number;
  cleanerCount: number;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  payouts: Payout[];
};

type Tone = "neutral" | "info" | "warning" | "success" | "danger";
const RUN_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  CONFIRMED: "info",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  VOID: "neutral",
};
const PAYOUT_TONE: Record<string, Tone> = {
  PENDING: "neutral",
  PROCESSING: "warning",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "info",
};

const RUN_STATUSES = ["DRAFT", "CONFIRMED", "PROCESSING", "COMPLETED", "FAILED", "VOID"];
const PAYOUT_STATUSES = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED", "REFUNDED"];

const money = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;
const fmtDate = (v: string) => new Date(v).toLocaleDateString("en-AU");

export function PayrollRunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [generatingAba, setGeneratingAba] = useState(false);

  useEffect(() => {
    void loadRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  async function loadRun() {
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}`);
      if (res.ok) setRun(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function changeRunStatus(status: string) {
    const res = await fetch(`/api/admin/payroll/runs/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) setRun(await res.json());
    else {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Update failed", description: body.error ?? "Failed to update status", variant: "destructive" });
    }
  }

  async function changePayoutStatus(payoutId: string, payoutStatus: string) {
    const res = await fetch(`/api/admin/payroll/runs/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payoutId, payoutStatus }),
    });
    if (res.ok) setRun(await res.json());
    else {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Update failed", description: body.error ?? "Failed to update payout", variant: "destructive" });
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}/confirm`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Confirm failed", description: err.error ?? "Failed to confirm", variant: "destructive" });
        return;
      }
      toast({ title: "Run confirmed" });
      await loadRun();
    } finally {
      setConfirming(false);
    }
  }

  async function handleProcess() {
    if (!window.confirm("This will process all payouts. Continue?")) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}/process`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Process failed", description: err.error ?? "Failed to process", variant: "destructive" });
        return;
      }
      const result = await res.json().catch(() => ({}));
      toast({
        title: "Payouts processed",
        description: `${result.successCount ?? 0} succeeded, ${result.failCount ?? 0} failed`,
      });
      await loadRun();
    } finally {
      setProcessing(false);
    }
  }

  async function handleDownloadAba() {
    setGeneratingAba(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}/aba`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "ABA failed", description: err.error ?? "Failed to generate ABA file", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-${runId}.aba`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGeneratingAba(false);
    }
  }

  if (loading) {
    return (
      <ECard>
        <ECardBody className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading payroll run…
        </ECardBody>
      </ECard>
    );
  }

  if (!run) {
    return (
      <ECard>
        <ECardBody className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Payroll run not found.
        </ECardBody>
      </ECard>
    );
  }

  const isDraft = run.status === "DRAFT";
  const isConfirmed = run.status === "CONFIRMED";
  const isCompleted = run.status === "COMPLETED";
  const isFailed = run.status === "FAILED";

  const summaryTiles: Array<{ label: string; value: string; gold?: boolean }> = [
    { label: "Job pay", value: money(run.totalPayable) },
    { label: "Shopping", value: money(run.totalShoppingReimbursements) },
    { label: "Transport", value: money(run.totalTransportAllowances) },
    { label: "Adjustments", value: money(run.totalAdjustments) },
    { label: "Grand total", value: money(run.grandTotal), gold: true },
  ];

  return (
    <div className="space-y-6">
      {/* Summary */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between">
          <div>
            <ECardTitle className="e-serif">
              {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
            </ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {run.cleanerCount} cleaner{run.cleanerCount !== 1 ? "s" : ""} · Created {fmtDate(run.createdAt)}
            </p>
          </div>
          <EBadge tone={RUN_TONE[run.status] ?? "neutral"} soft>
            {run.status}
          </EBadge>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-5">
            {summaryTiles.map((tile) => (
              <div
                key={tile.label}
                className={
                  "rounded-[var(--e-radius)] border p-3 " +
                  (tile.gold
                    ? "border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))]"
                    : "border-[hsl(var(--e-border))]")
                }
              >
                <EEyebrow>{tile.label}</EEyebrow>
                <p
                  className={
                    "e-numeral mt-1 text-[1.125rem] leading-none " +
                    (tile.gold ? "text-[hsl(var(--e-gold-ink))]" : "")
                  }
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {run.notes ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Notes: {run.notes}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            {isDraft ? (
              <EButton variant="primary" size="sm" onClick={handleConfirm} disabled={confirming}>
                {confirming ? "Confirming…" : "Confirm run"}
              </EButton>
            ) : null}
            {isConfirmed || isFailed ? (
              <EButton variant="gold" size="sm" onClick={handleProcess} disabled={processing}>
                {processing ? "Processing…" : "Process payouts"}
              </EButton>
            ) : null}
            {!isDraft ? (
              <EButton variant="outline" size="sm" onClick={handleDownloadAba} disabled={generatingAba}>
                {generatingAba ? "Generating…" : "Download ABA file"}
              </EButton>
            ) : null}
            {isCompleted ? (
              <EBadge tone="success" soft>
                Completed {run.completedAt ? new Date(run.completedAt).toLocaleString("en-AU") : ""}
              </EBadge>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Set status manually</span>
              <ESelect
                className="h-8 w-auto text-[0.75rem]"
                value={run.status}
                onChange={(e) => void changeRunStatus(e.target.value)}
                title="Manually override the run status"
              >
                {RUN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </ESelect>
            </div>
          </div>
        </ECardBody>
      </ECard>

      {/* Payouts */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Payouts ({run.payouts.length})</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-2 pt-0">
          {run.payouts.map((payout) => (
            <div
              key={payout.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-[550] text-[hsl(var(--e-foreground))]">
                    {payout.cleanerName || payout.cleanerEmail}
                  </span>
                  <EBadge tone={PAYOUT_TONE[payout.status] ?? "neutral"} soft>
                    {payout.status}
                  </EBadge>
                  <EBadge tone="neutral">{payout.method.replace(/_/g, " ")}</EBadge>
                  <ESelect
                    className="h-7 w-auto text-[0.6875rem]"
                    value={payout.status}
                    onChange={(e) => void changePayoutStatus(payout.id, e.target.value)}
                    title="Mark this payout paid / pending / etc."
                  >
                    {PAYOUT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </ESelect>
                </div>
                <div className="mt-1 flex flex-wrap gap-4 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {payout.shoppingReimbursement > 0 ? (
                    <span>Shopping: {money(payout.shoppingReimbursement)}</span>
                  ) : null}
                  {payout.transportAllowance > 0 ? <span>Transport: {money(payout.transportAllowance)}</span> : null}
                  {payout.adjustments > 0 ? <span>Adjustments: {money(payout.adjustments)}</span> : null}
                </div>
                {payout.failureReason ? (
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">Failed: {payout.failureReason}</p>
                ) : null}
                {payout.bankBsb ? (
                  <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    BSB: {payout.bankBsb} | Account: ****{payout.bankAccountNumber?.slice(-3)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={`/api/admin/finance/payroll/payslip?cleanerId=${encodeURIComponent(payout.cleanerId)}&startDate=${encodeURIComponent(String(run.periodStart).slice(0, 10))}&endDate=${encodeURIComponent(String(run.periodEnd).slice(0, 10))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[0.75rem] font-[550] text-[hsl(var(--e-accent-portal))] hover:underline"
                  title="Download payslip PDF for this period"
                >
                  Payslip PDF
                </a>
                <p className="e-numeral text-[1.125rem] text-[hsl(var(--e-foreground))]">{money(payout.amount)}</p>
              </div>
            </div>
          ))}
          {run.payouts.length === 0 ? (
            <p className="py-6 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No payouts in this run.
            </p>
          ) : null}
        </ECardBody>
      </ECard>
    </div>
  );
}
