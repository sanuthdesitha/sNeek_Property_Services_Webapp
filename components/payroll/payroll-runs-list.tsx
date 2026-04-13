"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type PayrollRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grandTotal: number;
  cleanerCount: number;
  createdAt: string;
  payouts: Array<{
    id: string;
    cleanerName: string | null;
    amount: number;
    status: string;
    method: string;
    failureReason: string | null;
  }>;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-blue-100 text-blue-800",
  PROCESSING: "bg-amber-100 text-amber-800",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

export function PayrollRunsList() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadRuns();
  }, []);

  async function loadRuns() {
    try {
      const res = await fetch("/api/admin/payroll/runs");
      if (res.ok) setRuns(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!periodStart || !periodEnd) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create payroll run");
        return;
      }
      const data = await res.json();
      router.push(`/admin/payroll/${data.id}`);
    } catch {
      alert("Failed to create payroll run");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading payroll runs...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Create new run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Payroll Run</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Period Start</label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Period End</label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <Button onClick={handleCreate} disabled={creating || !periodStart || !periodEnd}>
              {creating ? "Creating..." : "Create Payroll Run"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Runs list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payroll Runs ({runs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No payroll runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => router.push(`/admin/payroll/${run.id}`)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {new Date(run.periodStart).toLocaleDateString()} - {new Date(run.periodEnd).toLocaleDateString()}
                      </span>
                      <Badge className={STATUS_COLORS[run.status] || "bg-gray-100 text-gray-700"}>
                        {run.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {run.cleanerCount} cleaner{run.cleanerCount !== 1 ? "s" : ""} &middot; Created {new Date(run.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${run.grandTotal.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {run.payouts.filter((p) => p.status === "PAID").length}/{run.payouts.length} paid
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
