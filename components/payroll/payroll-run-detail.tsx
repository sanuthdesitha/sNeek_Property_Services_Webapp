"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-blue-100 text-blue-800",
  PROCESSING: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

const PAYOUT_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  PROCESSING: "bg-amber-100 text-amber-800",
};

export function PayrollRunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [generatingAba, setGeneratingAba] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadRun();
  }, [runId]);

  async function loadRun() {
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}`);
      if (res.ok) setRun(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}/confirm`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to confirm");
        return;
      }
      await loadRun();
    } catch {
      alert("Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function handleProcess() {
    if (!confirm("This will process all payouts. Continue?")) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}/process`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to process");
        return;
      }
      const result = await res.json();
      alert(`Processed: ${result.successCount} succeeded, ${result.failCount} failed`);
      await loadRun();
    } catch {
      alert("Failed to process");
    } finally {
      setProcessing(false);
    }
  }

  async function handleDownloadAba() {
    setGeneratingAba(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}/aba`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to generate ABA file");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-${runId}.aba`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download ABA file");
    } finally {
      setGeneratingAba(false);
    }
  }

  if (loading) {
    return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading payroll run...</div>;
  }

  if (!run) {
    return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Payroll run not found.</div>;
  }

  const isDraft = run.status === "DRAFT";
  const isConfirmed = run.status === "CONFIRMED";
  const isCompleted = run.status === "COMPLETED";
  const isFailed = run.status === "FAILED";

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {new Date(run.periodStart).toLocaleDateString()} - {new Date(run.periodEnd).toLocaleDateString()}
              </CardTitle>
              <CardDescription>
                {run.cleanerCount} cleaner{run.cleanerCount !== 1 ? "s" : ""} &middot; Created {new Date(run.createdAt).toLocaleDateString()}
              </CardDescription>
            </div>
            <Badge className={STATUS_COLORS[run.status] || "bg-gray-100 text-gray-700"}>{run.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Job Pay</p>
              <p className="text-lg font-semibold">${run.totalPayable.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Shopping</p>
              <p className="text-lg font-semibold">${run.totalShoppingReimbursements.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Transport</p>
              <p className="text-lg font-semibold">${run.totalTransportAllowances.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Adjustments</p>
              <p className="text-lg font-semibold">${run.totalAdjustments.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border p-3 bg-primary/5">
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <p className="text-lg font-bold">${run.grandTotal.toFixed(2)}</p>
            </div>
          </div>

          {run.notes && (
            <p className="mt-3 text-sm text-muted-foreground">Notes: {run.notes}</p>
          )}

          {/* Actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            {isDraft && (
              <Button onClick={handleConfirm} disabled={confirming}>
                {confirming ? "Confirming..." : "Confirm Run"}
              </Button>
            )}
            {(isConfirmed || isFailed) && (
              <Button onClick={handleProcess} disabled={processing} variant="default">
                {processing ? "Processing..." : "Process Payouts"}
              </Button>
            )}
            {!isDraft && (
              <Button onClick={handleDownloadAba} disabled={generatingAba} variant="outline">
                {generatingAba ? "Generating..." : "Download ABA File"}
              </Button>
            )}
            {isCompleted && (
              <Badge className="bg-green-100 text-green-800">
                Completed {run.completedAt ? new Date(run.completedAt).toLocaleString() : ""}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payouts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payouts ({run.payouts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {run.payouts.map((payout) => (
              <div key={payout.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{payout.cleanerName || payout.cleanerEmail}</span>
                    <Badge className={PAYOUT_STATUS_COLORS[payout.status] || "bg-gray-100 text-gray-700"}>
                      {payout.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {payout.method.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                    {payout.shoppingReimbursement > 0 && (
                      <span>Shopping: ${payout.shoppingReimbursement.toFixed(2)}</span>
                    )}
                    {payout.transportAllowance > 0 && (
                      <span>Transport: ${payout.transportAllowance.toFixed(2)}</span>
                    )}
                    {payout.adjustments > 0 && (
                      <span>Adjustments: ${payout.adjustments.toFixed(2)}</span>
                    )}
                  </div>
                  {payout.failureReason && (
                    <p className="mt-1 text-xs text-red-600">Failed: {payout.failureReason}</p>
                  )}
                  {payout.bankBsb && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      BSB: {payout.bankBsb} | Account: ****{payout.bankAccountNumber?.slice(-3)}
                    </p>
                  )}
                </div>
                <p className="text-lg font-semibold">${payout.amount.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
