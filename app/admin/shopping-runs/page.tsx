"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

type ShoppingRun = {
  id: string;
  name: string;
  status: "DRAFT" | "IN_PROGRESS" | "COMPLETED";
  ownerScope: "CLIENT" | "CLEANER";
  planningScope: string;
  updatedAt: string;
  totals: {
    lineCount: number;
    includedLineCount: number;
    estimatedTotalCost: number;
    bySupplier: Array<{
      supplier: string;
      category: string;
      lineCount: number;
      plannedUnits: number;
      estimatedCost: number;
    }>;
  };
};

export default function AdminShoppingRunsPage() {
  const [runs, setRuns] = useState<ShoppingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [poEmail, setPoEmail] = useState("");
  const [sending, setSending] = useState(false);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const supplierOptions = useMemo(() => {
    if (!selectedRun) return [];
    return Array.from(
      new Set(selectedRun.totals.bySupplier.map((row) => row.supplier).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [selectedRun]);

  async function loadRuns() {
    setLoading(true);
    const res = await fetch("/api/admin/inventory/shopping-runs");
    const body = await res.json().catch(() => []);
    const list = Array.isArray(body) ? (body as ShoppingRun[]) : [];
    setRuns(list);
    if (!selectedRunId && list.length > 0) {
      setSelectedRunId(list[0].id);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function downloadPo() {
    if (!selectedRunId) return;
    const query = new URLSearchParams();
    if (supplier) query.set("supplier", supplier);
    const res = await fetch(
      `/api/admin/inventory/shopping-runs/${selectedRunId}/po?${query.toString()}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({
        title: "Download failed",
        description: body.error ?? "Could not download purchase order PDF.",
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-order-${selectedRunId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function emailPo() {
    if (!selectedRunId) return;
    if (!poEmail.trim()) {
      toast({
        title: "Recipient required",
        description: "Enter an email to send this purchase order.",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    const res = await fetch(`/api/admin/inventory/shopping-runs/${selectedRunId}/po/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: poEmail.trim(),
        supplier: supplier || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      toast({
        title: "Email failed",
        description: body.error ?? "Could not email purchase order.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Purchase order emailed" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Shopping Runs</h2>
        <p className="text-sm text-muted-foreground">
          Generate supplier-ready purchase orders from saved shopping runs.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading shopping runs...</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shopping runs found. Save runs from Cleaner or Client shopping tools first.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="text-xs text-muted-foreground">Run</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedRunId}
                    onChange={(event) => {
                      setSelectedRunId(event.target.value);
                      setSupplier("");
                    }}
                  >
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.name} [{run.status}] ({run.ownerScope})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Supplier scope</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={supplier}
                    onChange={(event) => setSupplier(event.target.value)}
                  >
                    <option value="">All suppliers</option>
                    {supplierOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Email recipient</label>
                  <Input
                    type="email"
                    placeholder="supplier@example.com"
                    value={poEmail}
                    onChange={(event) => setPoEmail(event.target.value)}
                  />
                </div>
              </div>

              {selectedRun ? (
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">{selectedRun.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Included lines: {selectedRun.totals.includedLineCount} • Estimated total: $
                    {selectedRun.totals.estimatedTotalCost.toFixed(2)}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={downloadPo}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PO PDF
                </Button>
                <Button variant="outline" onClick={emailPo} disabled={sending}>
                  <Mail className="mr-2 h-4 w-4" />
                  {sending ? "Sending..." : "Email PO PDF"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
