"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Play,
  Plus,
  Receipt,
  Save,
  ShoppingBag,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type RunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
type PaymentMethod =
  | "COMPANY_CARD"
  | "CLIENT_CARD"
  | "CLEANER_PERSONAL_CARD"
  | "ADMIN_PERSONAL_CARD"
  | "CASH"
  | "BANK_TRANSFER"
  | "OTHER";
type PaidByScope = "COMPANY" | "CLIENT" | "CLEANER" | "ADMIN" | "OTHER";

type Attachment = {
  key: string;
  url: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
};

type RunRow = {
  propertyId: string;
  propertyName: string;
  suburb: string;
  itemId: string;
  isCustom?: boolean;
  itemName: string;
  category: string;
  supplier: string | null;
  unit: string;
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  needed: number;
  plannedQty: number;
  include: boolean;
  purchased: boolean;
  actualPurchasedQty?: number;
  actualUnitCost?: number | null;
  actualLineCost?: number | null;
  note?: string;
  priority?: "Emergency" | "High" | "Medium";
  estimatedUnitCost?: number | null;
  estimatedLineCost?: number | null;
};

type RunDetail = {
  id: string;
  name: string;
  status: RunStatus;
  planningScope: string;
  ownerScope: "CLIENT" | "CLEANER";
  ownerName: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  payment?: {
    method: PaymentMethod;
    paidByScope: PaidByScope;
    paidByUserId?: string | null;
    paidByName?: string | null;
    note?: string;
    receipts: Attachment[];
  };
  rows: RunRow[];
  totals?: {
    estimatedTotalCost?: number;
    actualTotalCost?: number;
  };
  clientChargeStatus?: string;
  cleanerReimbursementStatus?: string;
  shoppingTime?: {
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
};

type CustomDraft = {
  propertyId: string;
  itemName: string;
  category: string;
  unit: string;
  qty: string;
  unitCost: string;
  note: string;
};

function formatRunStatus(status: RunStatus) {
  if (status === "IN_PROGRESS") return "Shopping in progress";
  if (status === "COMPLETED") return "Submitted for admin review";
  return "Draft planning";
}

function derivePaidByScope(
  method: PaymentMethod,
  ownerScope: "CLIENT" | "CLEANER"
): PaidByScope {
  switch (method) {
    case "CLIENT_CARD":
      return "CLIENT";
    case "CLEANER_PERSONAL_CARD":
      return "CLEANER";
    case "ADMIN_PERSONAL_CARD":
      return "ADMIN";
    case "COMPANY_CARD":
      return "COMPANY";
    case "CASH":
    case "BANK_TRANSFER":
    case "OTHER":
      return ownerScope === "CLIENT" ? "CLIENT" : "CLEANER";
    default:
      return ownerScope === "CLIENT" ? "CLIENT" : "COMPANY";
  }
}

function paymentGuidance(method: PaymentMethod, ownerScope: "CLIENT" | "CLEANER") {
  const scope = derivePaidByScope(method, ownerScope);
  if (scope === "CLIENT") return "Client-paid purchase. No reimbursement is needed.";
  if (scope === "CLEANER")
    return "Cleaner-paid purchase. Admin approval is required before reimbursement goes to the next cleaner invoice.";
  if (scope === "ADMIN") return "Admin-paid purchase. Cleaner reimbursement is not needed.";
  return "Company-paid purchase. Cleaner reimbursement is not needed.";
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function timeLabel(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-AU");
}

export function ShoppingRunWorkspace({
  apiBase,
  runId,
  backHref,
  backLabel,
  title,
}: {
  apiBase: string;
  runId: string;
  backHref: string;
  backLabel: string;
  title: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft>({
    propertyId: "",
    itemName: "",
    category: "Custom purchase",
    unit: "unit",
    qty: "1",
    unitCost: "",
    note: "",
  });

  async function loadRun() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/${runId}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load shopping run.");
      setRun(body as RunDetail);
    } catch (error: any) {
      toast({ title: "Shopping run failed", description: error?.message ?? "Could not load shopping run.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRun();
  }, [apiBase, runId]);

  const grouped = useMemo(() => {
    if (!run) return [] as Array<{ propertyId: string; propertyName: string; suburb: string; rows: RunRow[] }>;
    const map = new Map<string, { propertyId: string; propertyName: string; suburb: string; rows: RunRow[] }>();
    for (const row of run.rows.filter((entry) => !entry.isCustom)) {
      const key = row.propertyId;
      if (!map.has(key)) {
        map.set(key, { propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [run]);

  const customRows = useMemo(
    () => (run?.rows ?? []).filter((entry) => entry.isCustom),
    [run]
  );

  const propertyOptions = useMemo(() => {
    if (!run) return [] as Array<{ propertyId: string; propertyName: string; suburb: string }>;
    const seen = new Map<string, { propertyId: string; propertyName: string; suburb: string }>();
    for (const row of run.rows) {
      if (!seen.has(row.propertyId)) {
        seen.set(row.propertyId, {
          propertyId: row.propertyId,
          propertyName: row.propertyName,
          suburb: row.suburb,
        });
      }
    }
    return Array.from(seen.values());
  }, [run]);

  useEffect(() => {
    if (!customDraft.propertyId && propertyOptions.length > 0) {
      setCustomDraft((prev) => ({ ...prev, propertyId: propertyOptions[0]!.propertyId }));
    }
  }, [customDraft.propertyId, propertyOptions]);

  const summary = useMemo(() => {
    if (!run) return { lines: 0, planned: 0, purchased: 0, estimated: 0, actual: 0 };
    return {
      lines: run.rows.length,
      planned: run.rows.filter((row) => row.include).reduce((sum, row) => sum + Number(row.plannedQty || 0), 0),
      purchased: run.rows.filter((row) => row.purchased).reduce((sum, row) => sum + Number(row.actualPurchasedQty || 0), 0),
      estimated: run.rows.reduce((sum, row) => sum + Number(row.estimatedLineCost || 0), 0),
      actual: run.rows.reduce((sum, row) => sum + Number(row.actualLineCost || 0), 0),
    };
  }, [run]);

  function updateRow(itemId: string, propertyId: string, patch: Partial<RunRow>) {
    setRun((prev) => {
      if (!prev) return prev;
      const nextRows = prev.rows.map((row) => {
        if (row.itemId !== itemId || row.propertyId !== propertyId) return row;
        const next = { ...row, ...patch };
        const actualPurchasedQty = Number(next.actualPurchasedQty || 0);
        const actualUnitCost = next.actualUnitCost == null ? null : Number(next.actualUnitCost || 0);
        next.actualLineCost = actualUnitCost == null ? null : actualPurchasedQty * actualUnitCost;
        const estimatedUnitCost =
          next.estimatedUnitCost == null ? actualUnitCost : Number(next.estimatedUnitCost || 0);
        next.estimatedUnitCost = estimatedUnitCost;
        next.estimatedLineCost =
          estimatedUnitCost == null ? null : Math.max(0, Number(next.plannedQty || 0)) * estimatedUnitCost;
        return next;
      });
      return {
        ...prev,
        rows: nextRows,
      };
    });
  }

  function updatePayment(patch: Partial<NonNullable<RunDetail["payment"]>>) {
    setRun((prev) => {
      if (!prev) return prev;
      const nextMethod =
        (patch.method ?? prev.payment?.method ?? (prev.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD")) as PaymentMethod;
      const basePayment = prev.payment ?? {
        method: prev.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD",
        paidByScope: prev.ownerScope === "CLIENT" ? "CLIENT" : "COMPANY",
        receipts: [],
      };
      return {
        ...prev,
        payment: {
          ...basePayment,
          ...patch,
          method: nextMethod,
          paidByScope: derivePaidByScope(nextMethod, prev.ownerScope),
        },
      };
    });
  }

  function addCustomPurchase() {
    if (!run) return;
    if (!customDraft.propertyId || !customDraft.itemName.trim()) {
      toast({
        title: "Custom purchase incomplete",
        description: "Choose a property and enter the purchase name.",
        variant: "destructive",
      });
      return;
    }
    const qty = Math.max(0, Number(customDraft.qty || 0));
    const unitCost = Math.max(0, Number(customDraft.unitCost || 0));
    if (qty <= 0 || unitCost <= 0) {
      toast({
        title: "Enter quantity and cost",
        description: "Custom purchases need both quantity and unit cost.",
        variant: "destructive",
      });
      return;
    }
    const property = propertyOptions.find((entry) => entry.propertyId === customDraft.propertyId);
    if (!property) {
      toast({
        title: "Property missing",
        description: "The selected property could not be resolved.",
        variant: "destructive",
      });
      return;
    }
    const itemId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `custom:${crypto.randomUUID()}`
        : `custom:${Date.now()}`;
    const nextRow: RunRow = {
      propertyId: property.propertyId,
      propertyName: property.propertyName,
      suburb: property.suburb,
      itemId,
      isCustom: true,
      itemName: customDraft.itemName.trim(),
      category: customDraft.category.trim() || "Custom purchase",
      supplier: null,
      unit: customDraft.unit.trim() || "unit",
      onHand: 0,
      parLevel: 0,
      reorderThreshold: 0,
      needed: 0,
      plannedQty: qty,
      include: true,
      purchased: true,
      actualPurchasedQty: qty,
      actualUnitCost: unitCost,
      actualLineCost: qty * unitCost,
      note: customDraft.note.trim() || undefined,
      priority: "Medium",
      estimatedUnitCost: unitCost,
      estimatedLineCost: qty * unitCost,
    };
    setRun((prev) => (prev ? { ...prev, rows: [...prev.rows, nextRow] } : prev));
    setCustomDraft((prev) => ({
      ...prev,
      itemName: "",
      qty: "1",
      unitCost: "",
      note: "",
    }));
    toast({ title: "Custom purchase added" });
  }

  function removeCustomPurchase(itemId: string, propertyId: string) {
    setRun((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.filter(
              (row) => !(row.itemId === itemId && row.propertyId === propertyId)
            ),
          }
        : prev
    );
  }

  async function save(statusOverride?: RunStatus) {
    if (!run) return;
    setSaving(true);
    try {
      const status = statusOverride ?? run.status;
      const now = new Date().toISOString();
      const payload = {
        name: run.name,
        status,
        planningScope: run.planningScope,
        startedAt: status === "IN_PROGRESS" || status === "COMPLETED" ? run.startedAt ?? now : run.startedAt ?? null,
        completedAt: status === "COMPLETED" ? run.completedAt ?? now : null,
        payment: run.payment,
        shoppingTime: run.ownerScope === "CLEANER" ? run.shoppingTime : undefined,
        rows: run.rows,
      };
      const res = await fetch(`${apiBase}/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save shopping run.");
      setRun(body as RunDetail);
      toast({ title: status === "COMPLETED" ? "Shopping run submitted" : "Shopping run saved" });
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not save shopping run.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function uploadReceipts(fileList: FileList | null) {
    if (!run || !fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "shopping-receipts");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.key) throw new Error(body.error ?? `Could not upload ${file.name}.`);
        uploaded.push({
          key: String(body.key),
          url: String(body.url ?? ""),
          name: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        });
      }
      updatePayment({ receipts: [...(run.payment?.receipts ?? []), ...uploaded] });
      toast({ title: "Receipts uploaded" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload receipts.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function downloadPdf() {
    if (!run) return;
    setDownloading(true);
    try {
      const res = await fetch(`${apiBase}/${run.id}/pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not generate shopping PDF.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `shopping-run-${run.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "PDF failed", description: error?.message ?? "Could not download the run PDF.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading shopping run...</div>;
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline"><Link href={backHref}>{backLabel}</Link></Button>
        <Card><CardContent className="py-10 text-sm text-muted-foreground">This shopping run could not be loaded.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">Run {run.name} · Owner {run.ownerName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" />{backLabel}</Link></Button>
          <Button variant="outline" onClick={() => void loadRun()}>Refresh</Button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><p className="text-xl font-semibold">{formatRunStatus(run.status)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Lines</p><p className="text-xl font-semibold">{summary.lines}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Planned units</p><p className="text-xl font-semibold">{summary.planned}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Purchased units</p><p className="text-xl font-semibold">{summary.purchased}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Estimated total</p><p className="text-xl font-semibold">{money(summary.estimated)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Actual total</p><p className="text-xl font-semibold">{money(summary.actual)}</p></CardContent></Card>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base">Run controls</CardTitle></CardHeader>
        <CardContent className="grid gap-3 xl:grid-cols-[1.2fr_180px_auto_auto_auto]">
          <Input value={run.name} onChange={(event) => setRun((prev) => prev ? { ...prev, name: event.target.value } : prev)} />
          <Input value={`Started ${timeLabel(run.startedAt)} · Submitted ${timeLabel(run.completedAt)}`} disabled />
          <Button variant="outline" onClick={() => void save("IN_PROGRESS")} disabled={saving || run.status === "COMPLETED"}><Play className="mr-2 h-4 w-4" />Mark active</Button>
          <Button variant="outline" onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save draft"}</Button>
          <Button onClick={() => void save("COMPLETED")} disabled={saving || run.status === "COMPLETED"}><ShoppingBag className="mr-2 h-4 w-4" />{run.status === "COMPLETED" ? "Submitted" : "Submit run"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />Payment and receipts</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={run.payment?.method ?? (run.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD")} onChange={(event) => updatePayment({ method: event.target.value as PaymentMethod })}>
              <option value="COMPANY_CARD">Company card</option>
              <option value="CLIENT_CARD">Client card</option>
              <option value="CLEANER_PERSONAL_CARD">Cleaner personal card</option>
              <option value="ADMIN_PERSONAL_CARD">Admin personal card</option>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="OTHER">Other</option>
            </select>
            <Input value={run.payment?.paidByScope?.replace(/_/g, " ") ?? "-"} disabled />
            <Input placeholder="Paid by name" value={run.payment?.paidByName ?? ""} onChange={(event) => updatePayment({ paidByName: event.target.value })} />
            <Input placeholder="Payment note" value={run.payment?.note ?? ""} onChange={(event) => updatePayment({ note: event.target.value })} />
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-950">
            {paymentGuidance(
              run.payment?.method ?? (run.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD"),
              run.ownerScope
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
              <input type="file" className="hidden" multiple accept="image/*,.pdf" onChange={(event) => { void uploadReceipts(event.target.files); event.currentTarget.value = ""; }} />
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload receipts"}
            </label>
            <Button variant="outline" onClick={downloadPdf} disabled={downloading}><Download className="mr-2 h-4 w-4" />{downloading ? "Preparing..." : "PDF"}</Button>
            <span className="text-xs text-muted-foreground">Client charge: {run.clientChargeStatus || "-"}</span>
            <span className="text-xs text-muted-foreground">Cleaner reimbursement: {run.cleanerReimbursementStatus || "-"}</span>
          </div>
          {(run.payment?.receipts?.length ?? 0) > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {(run.payment?.receipts ?? []).map((receipt) => (
                <div key={receipt.key} className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                  <a href={receipt.url} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">{receipt.name}</a>
                  <Button type="button" variant="ghost" size="sm" onClick={() => updatePayment({ receipts: (run.payment?.receipts ?? []).filter((item) => item.key !== receipt.key) })}>Remove</Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {run.ownerScope === "CLEANER" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shopping time</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Minutes spent shopping</label>
                <Input
                  type="number"
                  min="0"
                  max="1440"
                  value={run.shoppingTime?.requestedMinutes ?? 0}
                  onChange={(event) =>
                    setRun((prev) =>
                      prev
                        ? {
                            ...prev,
                            shoppingTime: {
                              requestedMinutes: Math.max(0, Number(event.target.value || 0)),
                              note: prev.shoppingTime?.note,
                              status: prev.shoppingTime?.status ?? "NOT_REQUESTED",
                              approvedMinutes: prev.shoppingTime?.approvedMinutes ?? 0,
                              approvedRate: prev.shoppingTime?.approvedRate ?? null,
                              approvedAmount: prev.shoppingTime?.approvedAmount ?? 0,
                              approvedAt: prev.shoppingTime?.approvedAt ?? null,
                              invoicedAt: prev.shoppingTime?.invoicedAt ?? null,
                              paidAt: prev.shoppingTime?.paidAt ?? null,
                            },
                          }
                        : prev
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Time note for admin</label>
                <Textarea
                  rows={3}
                  placeholder="What took extra time while shopping?"
                  value={run.shoppingTime?.note ?? ""}
                  onChange={(event) =>
                    setRun((prev) =>
                      prev
                        ? {
                            ...prev,
                            shoppingTime: {
                              requestedMinutes: prev.shoppingTime?.requestedMinutes ?? 0,
                              note: event.target.value,
                              status: prev.shoppingTime?.status ?? "NOT_REQUESTED",
                              approvedMinutes: prev.shoppingTime?.approvedMinutes ?? 0,
                              approvedRate: prev.shoppingTime?.approvedRate ?? null,
                              approvedAmount: prev.shoppingTime?.approvedAmount ?? 0,
                              approvedAt: prev.shoppingTime?.approvedAt ?? null,
                              invoicedAt: prev.shoppingTime?.invoicedAt ?? null,
                              paidAt: prev.shoppingTime?.paidAt ?? null,
                            },
                          }
                        : prev
                    )
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Status: {run.shoppingTime?.status?.replace(/_/g, " ") ?? "NOT REQUESTED"}</span>
              {run.shoppingTime?.approvedMinutes ? (
                <span>
                  Approved: {run.shoppingTime.approvedMinutes} min at {money(run.shoppingTime.approvedRate ?? 0)}/hr
                </span>
              ) : null}
              {run.shoppingTime?.approvedAmount ? (
                <span>Approved amount: {money(run.shoppingTime.approvedAmount)}</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Shopping time does not reach the cleaner invoice until admin approves it.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom purchases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_110px_110px]">
            <select
              className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
              value={customDraft.propertyId}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, propertyId: event.target.value }))
              }
            >
              <option value="">Select property</option>
              {propertyOptions.map((property) => (
                <option key={property.propertyId} value={property.propertyId}>
                  {property.propertyName} ({property.suburb})
                </option>
              ))}
            </select>
            <Input
              placeholder="Purchase name"
              value={customDraft.itemName}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, itemName: event.target.value }))
              }
            />
            <Input
              placeholder="Qty"
              type="number"
              min="0"
              step="0.01"
              value={customDraft.qty}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, qty: event.target.value }))
              }
            />
            <Input
              placeholder="Unit cost"
              type="number"
              min="0"
              step="0.01"
              value={customDraft.unitCost}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, unitCost: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_140px_1fr_auto]">
            <Input
              placeholder="Category"
              value={customDraft.category}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, category: event.target.value }))
              }
            />
            <Input
              placeholder="Unit"
              value={customDraft.unit}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, unit: event.target.value }))
              }
            />
            <Input
              placeholder="Optional note"
              value={customDraft.note}
              onChange={(event) =>
                setCustomDraft((prev) => ({ ...prev, note: event.target.value }))
              }
            />
            <Button type="button" onClick={addCustomPurchase}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>
          {customRows.length > 0 ? (
            <div className="space-y-3">
              {customRows.map((row) => (
                <div key={`${row.propertyId}-${row.itemId}`} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.itemName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.propertyName} · {row.category} · {row.unit}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCustomPurchase(row.itemId, row.propertyId)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[120px_120px_1fr]">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.actualPurchasedQty ?? 0}
                      onChange={(event) =>
                        updateRow(row.itemId, row.propertyId, {
                          actualPurchasedQty: Math.max(0, Number(event.target.value || 0)),
                          plannedQty: Math.max(0, Number(event.target.value || 0)),
                          purchased: true,
                          include: true,
                        })
                      }
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.actualUnitCost ?? 0}
                      onChange={(event) =>
                        updateRow(row.itemId, row.propertyId, {
                          actualUnitCost: Math.max(0, Number(event.target.value || 0)),
                          purchased: true,
                          include: true,
                        })
                      }
                    />
                    <Input
                      value={row.note ?? ""}
                      onChange={(event) =>
                        updateRow(row.itemId, row.propertyId, { note: event.target.value })
                      }
                      placeholder="Receipt or purchase note"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add manual purchases here when the item was not already on the planned shopping list.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {grouped.map((group) => (
          <Card key={group.propertyId}>
            <CardHeader><CardTitle className="text-base">{group.propertyName} <span className="text-sm font-normal text-muted-foreground">({group.suburb})</span></CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {group.rows.map((row) => (
                <div key={`${row.propertyId}-${row.itemId}`} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.itemName}</p>
                      <p className="text-xs text-muted-foreground">{row.category}{row.supplier ? ` · ${row.supplier}` : ""} · {row.unit}</p>
                      <p className="mt-1 text-xs text-muted-foreground">On hand {row.onHand} · Need {row.needed} · Planned {row.plannedQty}</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input type="number" min="0" value={row.actualPurchasedQty ?? 0} onChange={(event) => updateRow(row.itemId, row.propertyId, { actualPurchasedQty: Math.max(0, Number(event.target.value || 0)), purchased: true })} />
                      <Input type="number" min="0" step="0.01" value={row.actualUnitCost ?? ""} onChange={(event) => updateRow(row.itemId, row.propertyId, { actualUnitCost: event.target.value === "" ? null : Math.max(0, Number(event.target.value || 0)), purchased: true })} />
                      <label className="flex items-center justify-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={row.purchased} onChange={(event) => updateRow(row.itemId, row.propertyId, { purchased: event.target.checked })} />Bought</label>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_180px]">
                    <Textarea rows={2} placeholder="Item note / not found note" value={row.note ?? ""} onChange={(event) => updateRow(row.itemId, row.propertyId, { note: event.target.value })} />
                    <Input value={row.priority || "Medium"} disabled />
                    <Input value={`Actual ${money(row.actualLineCost || 0)}`} disabled />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

