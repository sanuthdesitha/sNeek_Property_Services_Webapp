"use client";

/**
 * "Cleaner pay" card for the ADMIN job details / manage surfaces (requirement
 * 1+2's primary home). Fetches the canonical per-job pay summary
 * (GET /api/admin/jobs/:id/pay-summary → lib/finance/job-pay-summary.ts) and
 * renders, per payee: base pay + basis, the full adjustment list (shared
 * component, admin variant — editable in place), the approved total, and the
 * pending delta shown separately. Refetches itself after any successful edit so
 * every mounted instance shows the same truth.
 */
import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import {
  PayAdjustmentList,
  type PayAdjustmentListItem,
} from "@/components/v2/shared/pay-adjustment-list";

interface PayeeSummary {
  cleanerId: string;
  cleanerName: string;
  cleanerRole: string | null;
  assigned: boolean;
  basePay: {
    amount: number;
    basis: "ALLOCATED" | "TIMER" | "NONE";
    hours: number;
    rate: number | null;
    rateMissing: boolean;
    split: number;
    source: "CUSTOM" | "JOBTYPE_RATE" | "NONE";
  };
  transportAllowance: number;
  adjustments: PayAdjustmentListItem[];
  approvedTotal: number;
  pendingDelta: number;
}

interface JobPaySummaryResponse {
  jobId: string;
  jobNumber: string | null;
  propertyName: string | null;
  payees: PayeeSummary[];
}

function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function basisLine(p: PayeeSummary): string {
  const b = p.basePay;
  // Wording matches the admin input ("Fixed pay") and the invoice column.
  if (b.source === "CUSTOM") return "Fixed pay (flat amount)";
  if (b.basis === "NONE") return "Not assigned to this job — adjustments only";
  const basis = b.basis === "ALLOCATED" ? "allocated" : "clocked";
  const rate = b.rate != null ? `$${b.rate.toFixed(2)}/h` : "rate not set";
  const split = b.split > 1 ? ` · split ×${b.split}` : "";
  return `${b.hours.toFixed(2)}h ${basis} × ${rate}${split}`;
}

export function JobPayCard({ jobId }: { jobId: string }) {
  const [data, setData] = React.useState<JobPaySummaryResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/pay-summary`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load the pay summary.");
      setData(body);
    } catch (err: any) {
      setError(err?.message ?? "Could not load the pay summary.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Freshness on focus: a decision made in another tab (Approval Center) must
  // show up here without a manual reload.
  React.useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return (
    <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.8125rem] font-[550]">Cleaner pay (canonical)</p>
        <EButton variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </EButton>
      </div>
      <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
        The same calculator as the cleaner invoice and payroll — base pay, every automatic and
        manual adjustment, and what will actually be paid.
      </p>

      {error ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {!error && !loading && (data?.payees.length ?? 0) === 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          No assigned cleaners or pay adjustments on this job yet.
        </p>
      ) : null}

      {(data?.payees ?? []).map((p) => (
        <div
          key={p.cleanerId}
          className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.8125rem] font-[550]">{p.cleanerName}</span>
            {p.cleanerRole && p.cleanerRole !== "CLEANER" ? (
              <EBadge tone="info" soft>{p.cleanerRole.replace(/_/g, " ")}</EBadge>
            ) : null}
            {!p.assigned ? <EBadge tone="warning" soft>Not assigned — payee only</EBadge> : null}
            {p.basePay.rateMissing ? <EBadge tone="danger" soft>Rate not set</EBadge> : null}
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[0.8125rem]">
            <span className="text-[hsl(var(--e-muted-foreground))]">
              Base {money(p.basePay.amount)} — {basisLine(p)}
              {p.transportAllowance > 0 ? ` · transport ${money(p.transportAllowance)}` : ""}
            </span>
          </div>

          <PayAdjustmentList
            items={p.adjustments}
            variant="admin"
            payeeId={p.cleanerId}
            onChanged={load}
            emptyText="No pay adjustments for this payee on this job."
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-2">
            <span className="text-[0.8125rem] font-[600]">
              Will pay: <span className="e-numeral">{money(p.approvedTotal)}</span>
            </span>
            {p.pendingDelta !== 0 ? (
              <span className="text-[0.75rem] text-[hsl(var(--e-warning))]">
                Pending changes: {money(p.pendingDelta)} (not included until approved)
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
