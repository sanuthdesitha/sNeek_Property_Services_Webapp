"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

type Allocation = {
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  propertyIds: string[];
  propertyNames: string[];
  lineCount: number;
  actualAmount: number;
  estimatedAmount: number;
  receiptCount: number;
  requiresClientCharge: boolean;
};

type ShoppingRun = {
  id: string;
  name: string;
  status: "DRAFT" | "IN_PROGRESS" | "COMPLETED";
  ownerScope: "CLIENT" | "CLEANER";
  ownerName: string;
  ownerEmail: string;
  planningScope: string;
  updatedAt: string;
  clientChargeStatus: "NOT_REQUIRED" | "READY" | "SENT" | "PAID";
  cleanerReimbursementStatus: "NOT_APPLICABLE" | "READY" | "INVOICED" | "REIMBURSED";
  paidByDisplay: string;
  payment: {
    method: string;
    paidByScope: string;
    paidByName?: string | null;
    note?: string;
    receipts: Array<{ key: string; url: string; name: string }>;
  };
  shoppingTime: {
    requestedMinutes: number;
    note?: string;
    status: "NOT_REQUESTED" | "PENDING" | "APPROVED" | "INVOICED" | "PAID";
    approvedMinutes: number;
    approvedRate?: number | null;
    approvedAmount: number;
    approvedAt?: string | null;
    invoicedAt?: string | null;
    paidAt?: string | null;
  };
  totals: {
    includedLineCount: number;
    estimatedTotalCost: number;
    actualTotalCost: number;
    bySupplier: Array<{
      supplier: string;
      category: string;
      lineCount: number;
      plannedUnits: number;
      estimatedCost: number;
    }>;
  };
  clientAllocations: Allocation[];
};

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export default function AdminShoppingRunsPage() {
  const [runs, setRuns] = useState<ShoppingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [poEmail, setPoEmail] = useState("");
  const [reimbursementEmail, setReimbursementEmail] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [shoppingMinutes, setShoppingMinutes] = useState("");
  const [shoppingRate, setShoppingRate] = useState("");
  const [busy, setBusy] = useState<string>("");

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

  const selectedAllocation = useMemo(() => {
    if (!selectedRun) return null;
    return (
      selectedRun.clientAllocations.find((row) => row.clientId === (selectedClientId || null)) ??
      selectedRun.clientAllocations[0] ??
      null
    );
  }, [selectedRun, selectedClientId]);

  async function loadRuns() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory/shopping-runs");
      const body = await res.json().catch(() => []);
      const list = Array.isArray(body) ? (body as ShoppingRun[]) : [];
      setRuns(list);
      if (!selectedRunId && list.length > 0) {
        setSelectedRunId(list[0].id);
        setSelectedClientId(list[0].clientAllocations[0]?.clientId ?? "");
        setReimbursementEmail(list[0].clientAllocations[0]?.clientEmail ?? "");
      } else if (selectedRunId) {
        const current = list.find((run) => run.id === selectedRunId);
        if (current) {
          const allocation =
            current.clientAllocations.find((row) => row.clientId === (selectedClientId || null)) ??
            current.clientAllocations[0] ??
            null;
          setSelectedClientId(allocation?.clientId ?? "");
          setReimbursementEmail(allocation?.clientEmail ?? reimbursementEmail);
        }
      }
    } catch {
      toast({
        title: "Shopping runs failed",
        description: "Could not load shopping runs.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!selectedRun) return;
    setShoppingMinutes(
      String(selectedRun.shoppingTime?.approvedMinutes || selectedRun.shoppingTime?.requestedMinutes || 0)
    );
    setShoppingRate(
      selectedRun.shoppingTime?.approvedRate != null
        ? String(selectedRun.shoppingTime.approvedRate)
        : ""
    );
  }, [selectedRun]);

  async function downloadPdf(url: string, fileName: string) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Could not generate PDF.");
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function downloadPo() {
    if (!selectedRunId) return;
    const query = new URLSearchParams();
    if (supplier) query.set("supplier", supplier);
    try {
      await downloadPdf(
        `/api/admin/inventory/shopping-runs/${selectedRunId}/po?${query.toString()}`,
        `purchase-order-${selectedRunId}.pdf`
      );
      toast({ title: "Purchase order downloaded" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }

  async function emailPo() {
    if (!selectedRunId) return;
    if (!poEmail.trim()) {
      return toast({
        title: "Recipient required",
        description: "Enter an email to send the purchase order.",
        variant: "destructive",
      });
    }
    setBusy("po-email");
    const res = await fetch(`/api/admin/inventory/shopping-runs/${selectedRunId}/po/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: poEmail.trim(),
        supplier: supplier || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      return toast({
        title: "Email failed",
        description: body.error ?? "Could not email purchase order.",
        variant: "destructive",
      });
    }
    toast({ title: "Purchase order emailed" });
  }

  async function downloadReimbursement() {
    if (!selectedRunId || !selectedAllocation) return;
    const query = new URLSearchParams();
    if (selectedAllocation.clientId) query.set("clientId", selectedAllocation.clientId);
    try {
      await downloadPdf(
        `/api/admin/inventory/shopping-runs/${selectedRunId}/reimbursement?${query.toString()}`,
        `shopping-reimbursement-${selectedRunId}.pdf`
      );
      toast({ title: "Reimbursement pack downloaded" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }

  async function emailReimbursement() {
    if (!selectedRunId || !selectedAllocation) return;
    if (!reimbursementEmail.trim()) {
      return toast({
        title: "Recipient required",
        description: "Enter the client email for the reimbursement pack.",
        variant: "destructive",
      });
    }
    setBusy("reimbursement-email");
    const res = await fetch(
      `/api/admin/inventory/shopping-runs/${selectedRunId}/reimbursement/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: reimbursementEmail.trim(),
          clientId: selectedAllocation.clientId ?? undefined,
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      return toast({
        title: "Email failed",
        description: body.error ?? "Could not email reimbursement pack.",
        variant: "destructive",
      });
    }
    toast({ title: "Reimbursement pack emailed" });
    await loadRuns();
  }

  async function updateRunStatus(payload: Record<string, unknown>, successTitle: string) {
    if (!selectedRunId) return;
    setBusy(successTitle);
    const res = await fetch(`/api/admin/inventory/shopping-runs/${selectedRunId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      return toast({
        title: "Update failed",
        description: body.error ?? "Could not update run.",
        variant: "destructive",
      });
    }
    toast({ title: successTitle });
    await loadRuns();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Shopping Runs</h2>
        <p className="text-sm text-muted-foreground">
          Review active shopping runs, receipts, who paid, and what needs to be reimbursed to
          cleaners or clients.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Selection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading shopping runs...</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shopping runs found. Save runs from Cleaner or Client shopping tools first.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Run</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedRunId}
                  onChange={(event) => {
                    const run = runs.find((item) => item.id === event.target.value);
                    setSelectedRunId(event.target.value);
                    setSelectedClientId(run?.clientAllocations[0]?.clientId ?? "");
                    setReimbursementEmail(run?.clientAllocations[0]?.clientEmail ?? "");
                  }}
                >
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.name} [{run.status}] ({run.ownerScope})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
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
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Client allocation</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedClientId}
                  onChange={(event) => {
                    const allocation =
                      selectedRun?.clientAllocations.find(
                        (row) => row.clientId === (event.target.value || null)
                      ) ?? null;
                    setSelectedClientId(event.target.value);
                    setReimbursementEmail(allocation?.clientEmail ?? "");
                  }}
                >
                  {(selectedRun?.clientAllocations ?? []).map((allocation) => (
                    <option key={allocation.clientId ?? allocation.clientName} value={allocation.clientId ?? ""}>
                      {allocation.clientName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Client reimbursement email</label>
                <Input
                  type="email"
                  value={reimbursementEmail}
                  onChange={(event) => setReimbursementEmail(event.target.value)}
                  placeholder="client@example.com"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRun ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Owner</p><p className="text-lg font-semibold">{selectedRun.ownerName}</p><p className="text-xs text-muted-foreground">{selectedRun.ownerEmail}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid by</p><p className="text-lg font-semibold">{selectedRun.paidByDisplay}</p><p className="text-xs text-muted-foreground">{selectedRun.payment.method.replace(/_/g, " ")}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Estimated</p><p className="text-lg font-semibold">{money(selectedRun.totals.estimatedTotalCost)}</p><p className="text-xs text-muted-foreground">{selectedRun.totals.includedLineCount} included lines</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Actual</p><p className="text-lg font-semibold">{money(selectedRun.totals.actualTotalCost)}</p><p className="text-xs text-muted-foreground">{selectedRun.payment.receipts.length} receipts</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Statuses</p><div className="flex flex-wrap gap-2 pt-1"><Badge variant="secondary">Client: {selectedRun.clientChargeStatus}</Badge><Badge variant="secondary">Cleaner: {selectedRun.cleanerReimbursementStatus}</Badge><Badge variant="secondary">Shopping time: {selectedRun.shoppingTime.status}</Badge></div></CardContent></Card>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Purchase order actions</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">PO email recipient</label>
                  <Input
                    type="email"
                    placeholder="supplier@example.com"
                    value={poEmail}
                    onChange={(event) => setPoEmail(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={downloadPo}>Download PO PDF</Button>
                  <Button variant="outline" onClick={emailPo} disabled={busy === "po-email"}>
                    {busy === "po-email" ? "Sending..." : "Email PO PDF"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Reimbursement actions</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {selectedAllocation ? (
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <p className="font-medium">{selectedAllocation.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      Amount due: {money(selectedAllocation.actualAmount)} | Properties:{" "}
                      {selectedAllocation.propertyNames.join(", ")}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No client allocation found for this run.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={downloadReimbursement} disabled={!selectedAllocation}>
                    Download reimbursement PDF
                  </Button>
                  <Button
                    variant="outline"
                    onClick={emailReimbursement}
                    disabled={!selectedAllocation || busy === "reimbursement-email"}
                  >
                    {busy === "reimbursement-email" ? "Sending..." : "Email reimbursement pack"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateRunStatus(
                        {
                          clientChargeStatus: "PAID",
                          clientChargePaidAt: new Date().toISOString(),
                        },
                        "Client charge marked paid"
                      )
                    }
                  >
                    Mark client charge paid
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateRunStatus(
                        {
                          cleanerReimbursementStatus: "REIMBURSED",
                          cleanerReimbursementPaidAt: new Date().toISOString(),
                        },
                        "Cleaner reimbursement marked paid"
                      )
                    }
                  >
                    Mark cleaner reimbursed
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {selectedRun.ownerScope === "CLEANER" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Shopping time approval</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">
                    Requested time: {selectedRun.shoppingTime.requestedMinutes} min
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Status: {selectedRun.shoppingTime.status.replace(/_/g, " ")}
                    {selectedRun.shoppingTime.note ? ` | Note: ${selectedRun.shoppingTime.note}` : ""}
                  </p>
                  {selectedRun.shoppingTime.approvedAmount > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Approved: {selectedRun.shoppingTime.approvedMinutes} min at{" "}
                      {money(selectedRun.shoppingTime.approvedRate ?? 0)}/hr ={" "}
                      {money(selectedRun.shoppingTime.approvedAmount)}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Approved minutes</label>
                    <Input
                      type="number"
                      min="0"
                      max="1440"
                      value={shoppingMinutes}
                      onChange={(event) => setShoppingMinutes(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Approved hourly rate</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={shoppingRate}
                      onChange={(event) => setShoppingRate(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateRunStatus(
                        {
                          shoppingTime: {
                            status: "APPROVED",
                            approvedMinutes: Math.max(0, Number(shoppingMinutes || 0)),
                            approvedRate: Math.max(0, Number(shoppingRate || 0)),
                          },
                        },
                        "Shopping time approved"
                      )
                    }
                    disabled={
                      selectedRun.shoppingTime.requestedMinutes <= 0 ||
                      Number(shoppingMinutes || 0) <= 0 ||
                      Number(shoppingRate || 0) <= 0
                    }
                  >
                    Approve shopping time
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateRunStatus(
                        {
                          shoppingTime: {
                            status: "PENDING",
                            approvedMinutes: 0,
                            approvedRate: 0,
                          },
                        },
                        "Shopping time moved back to pending"
                      )
                    }
                    disabled={selectedRun.shoppingTime.requestedMinutes <= 0}
                  >
                    Reset approval
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateRunStatus(
                        {
                          shoppingTime: {
                            status: "PAID",
                            paidAt: new Date().toISOString(),
                          },
                        },
                        "Shopping time marked paid"
                      )
                    }
                    disabled={selectedRun.shoppingTime.status !== "INVOICED"}
                  >
                    Mark shopping time paid
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Approved shopping time is added to the next cleaner invoice. It stays hidden from the cleaner invoice until approved here.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle className="text-base">Client allocations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {selectedRun.clientAllocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No client allocation data for this run.</p>
              ) : (
                selectedRun.clientAllocations.map((allocation) => (
                  <div key={allocation.clientId ?? allocation.clientName} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{allocation.clientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {allocation.propertyNames.join(", ")}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold">{money(allocation.actualAmount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {allocation.lineCount} lines | Receipts {allocation.receiptCount}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Receipts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {selectedRun.payment.receipts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receipts uploaded for this run yet.</p>
              ) : (
                selectedRun.payment.receipts.map((receipt) => (
                  <div key={receipt.key} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                    <a href={receipt.url} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">
                      {receipt.name}
                    </a>
                    <Button asChild variant="ghost" size="sm">
                      <a href={receipt.url} target="_blank" rel="noreferrer">Open</a>
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
