"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Play, Receipt, Save, ShoppingBag, Upload } from "lucide-react";
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
};

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
    for (const row of run.rows) {
      const key = row.propertyId;
      if (!map.has(key)) {
        map.set(key, { propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [run]);

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
      return {
        ...prev,
        payment: {
          method: "CLIENT_CARD",
          paidByScope: prev.ownerScope === "CLIENT" ? "CLIENT" : "COMPANY",
          receipts: [],
          ...(prev.payment ?? {}),
          ...patch,
        },
      };
    });
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
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><p className="text-xl font-semibold">{run.status.replace(/_/g, " ")}</p></CardContent></Card>
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
          <Input value={`Started ${timeLabel(run.startedAt)} · Completed ${timeLabel(run.completedAt)}`} disabled />
          <Button variant="outline" onClick={() => void save("IN_PROGRESS")} disabled={saving || run.status === "COMPLETED"}><Play className="mr-2 h-4 w-4" />Start</Button>
          <Button variant="outline" onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save"}</Button>
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
            <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={run.payment?.paidByScope ?? (run.ownerScope === "CLIENT" ? "CLIENT" : "COMPANY")} onChange={(event) => updatePayment({ paidByScope: event.target.value as PaidByScope })}>
              <option value="COMPANY">Company</option>
              <option value="CLIENT">Client</option>
              <option value="CLEANER">Cleaner</option>
              <option value="ADMIN">Admin</option>
              <option value="OTHER">Other</option>
            </select>
            <Input placeholder="Paid by name" value={run.payment?.paidByName ?? ""} onChange={(event) => updatePayment({ paidByName: event.target.value })} />
            <Input placeholder="Payment note" value={run.payment?.note ?? ""} onChange={(event) => updatePayment({ note: event.target.value })} />
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

