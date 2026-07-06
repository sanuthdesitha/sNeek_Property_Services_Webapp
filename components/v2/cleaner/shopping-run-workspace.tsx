"use client";

/**
 * Estate cleaner shopping-run executor. Same endpoints + payloads as the live
 * workspace (components/inventory/shopping-run-workspace.tsx), on the cleaner
 * API base (so ownerScope is CLEANER, never the admin on-hand ledger):
 *   GET   {apiBase}/{runId}            → RunDetail
 *   PATCH {apiBase}/{runId}            { name, status, planningScope, startedAt,
 *           completedAt, payment, shoppingTime, rows }
 *   GET   {apiBase}/{runId}/pdf        → PDF blob
 *   POST  /api/uploads/direct          (receipt files, folder=shopping-receipts)
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  ShoppingBag,
  Trash2,
  Upload,
} from "lucide-react";
import {
  EAlert,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { ECheckbox, EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
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
type Attachment = { key: string; url: string; name: string; mimeType?: string; sizeBytes?: number };

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

type ShoppingTime = {
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
  totals?: { estimatedTotalCost?: number; actualTotalCost?: number };
  clientChargeStatus?: string;
  cleanerReimbursementStatus?: string;
  shoppingTime?: ShoppingTime;
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
function derivePaidByScope(method: PaymentMethod, ownerScope: "CLIENT" | "CLEANER"): PaidByScope {
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
      toast({ title: "Shopping run failed", description: error?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, runId]);

  const grouped = useMemo(() => {
    if (!run) return [] as Array<{ propertyId: string; propertyName: string; suburb: string; rows: RunRow[] }>;
    const map = new Map<string, { propertyId: string; propertyName: string; suburb: string; rows: RunRow[] }>();
    for (const row of run.rows.filter((e) => !e.isCustom)) {
      const key = row.propertyId;
      if (!map.has(key)) {
        map.set(key, { propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [run]);

  const customRows = useMemo(() => (run?.rows ?? []).filter((e) => e.isCustom), [run]);

  const propertyOptions = useMemo(() => {
    if (!run) return [] as Array<{ propertyId: string; propertyName: string; suburb: string }>;
    const seen = new Map<string, { propertyId: string; propertyName: string; suburb: string }>();
    for (const row of run.rows) {
      if (!seen.has(row.propertyId)) {
        seen.set(row.propertyId, { propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb });
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
      planned: run.rows.filter((r) => r.include).reduce((s, r) => s + Number(r.plannedQty || 0), 0),
      purchased: run.rows.filter((r) => r.purchased).reduce((s, r) => s + Number(r.actualPurchasedQty || 0), 0),
      estimated: run.rows.reduce((s, r) => s + Number(r.estimatedLineCost || 0), 0),
      actual: run.rows.reduce((s, r) => s + Number(r.actualLineCost || 0), 0),
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
        const estimatedUnitCost = next.estimatedUnitCost == null ? actualUnitCost : Number(next.estimatedUnitCost || 0);
        next.estimatedUnitCost = estimatedUnitCost;
        next.estimatedLineCost =
          estimatedUnitCost == null ? null : Math.max(0, Number(next.plannedQty || 0)) * estimatedUnitCost;
        return next;
      });
      return { ...prev, rows: nextRows };
    });
  }

  function updatePayment(patch: Partial<NonNullable<RunDetail["payment"]>>) {
    setRun((prev) => {
      if (!prev) return prev;
      const nextMethod = (patch.method ??
        prev.payment?.method ??
        (prev.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD")) as PaymentMethod;
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

  function setTime(patch: Partial<ShoppingTime>) {
    setRun((prev) =>
      prev
        ? {
            ...prev,
            shoppingTime: {
              requestedMinutes: prev.shoppingTime?.requestedMinutes ?? 0,
              note: prev.shoppingTime?.note,
              status: prev.shoppingTime?.status ?? "NOT_REQUESTED",
              approvedMinutes: prev.shoppingTime?.approvedMinutes ?? 0,
              approvedRate: prev.shoppingTime?.approvedRate ?? null,
              approvedAmount: prev.shoppingTime?.approvedAmount ?? 0,
              approvedAt: prev.shoppingTime?.approvedAt ?? null,
              invoicedAt: prev.shoppingTime?.invoicedAt ?? null,
              paidAt: prev.shoppingTime?.paidAt ?? null,
              ...patch,
            },
          }
        : prev
    );
  }

  function addCustomPurchase() {
    if (!run) return;
    if (!customDraft.propertyId || !customDraft.itemName.trim()) {
      toast({ title: "Custom purchase incomplete", description: "Choose a property and enter the purchase name.", variant: "destructive" });
      return;
    }
    const qty = Math.max(0, Number(customDraft.qty || 0));
    const unitCost = Math.max(0, Number(customDraft.unitCost || 0));
    if (qty <= 0 || unitCost <= 0) {
      toast({ title: "Enter quantity and cost", description: "Custom purchases need both quantity and unit cost.", variant: "destructive" });
      return;
    }
    const property = propertyOptions.find((e) => e.propertyId === customDraft.propertyId);
    if (!property) {
      toast({ title: "Property missing", variant: "destructive" });
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
    setCustomDraft((prev) => ({ ...prev, itemName: "", qty: "1", unitCost: "", note: "" }));
    toast({ title: "Custom purchase added" });
  }

  function removeCustomPurchase(itemId: string, propertyId: string) {
    setRun((prev) =>
      prev ? { ...prev, rows: prev.rows.filter((r) => !(r.itemId === itemId && r.propertyId === propertyId)) } : prev
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
      toast({ title: "Save failed", description: error?.message, variant: "destructive" });
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
      toast({ title: "Upload failed", description: error?.message, variant: "destructive" });
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
      toast({ title: "PDF failed", description: error?.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <div className="py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading shopping run…</div>;
  }
  if (!run) {
    return (
      <div className="space-y-4">
        <EButton asChild variant="outline">
          <Link href={backHref}>{backLabel}</Link>
        </EButton>
        <ECard>
          <ECardBody className="py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            This shopping run could not be loaded.
          </ECardBody>
        </ECard>
      </div>
    );
  }

  const method = run.payment?.method ?? (run.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="e-display-sm">{title}</h2>
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Run {run.name} · Owner {run.ownerName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <EButton asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </EButton>
          <EButton variant="ghost" size="sm" onClick={() => void loadRun()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </EButton>
        </div>
      </div>

      {/* Summary */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "Status", value: formatRunStatus(run.status) },
          { label: "Lines", value: summary.lines },
          { label: "Planned units", value: summary.planned },
          { label: "Purchased units", value: summary.purchased },
          { label: "Estimated total", value: money(summary.estimated) },
          { label: "Actual total", value: money(summary.actual) },
        ].map((s) => (
          <ECard key={s.label}>
            <ECardBody className="p-4">
              <p className="e-eyebrow text-[0.625rem]">{s.label}</p>
              <p className="mt-1 text-[1.125rem] font-[550] leading-tight">{s.value}</p>
            </ECardBody>
          </ECard>
        ))}
      </section>

      {/* Controls */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Run controls</ECardTitle>
        </ECardHeader>
        <ECardBody className="grid gap-3 xl:grid-cols-[1.2fr_200px_auto_auto_auto] xl:items-end">
          <EField label="Run name">
            <EInput value={run.name} onChange={(e) => setRun((prev) => (prev ? { ...prev, name: e.target.value } : prev))} />
          </EField>
          <EField label="Timeline">
            <EInput value={`Started ${timeLabel(run.startedAt)} · Submitted ${timeLabel(run.completedAt)}`} disabled />
          </EField>
          <EButton variant="outline" onClick={() => void save("IN_PROGRESS")} disabled={saving || run.status === "COMPLETED"}>
            <Play className="h-4 w-4" /> Mark active
          </EButton>
          <EButton variant="outline" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save draft"}
          </EButton>
          <EButton variant="gold" onClick={() => void save("COMPLETED")} disabled={saving || run.status === "COMPLETED"}>
            <ShoppingBag className="h-4 w-4" /> {run.status === "COMPLETED" ? "Submitted" : "Submit run"}
          </EButton>
        </ECardBody>
      </ECard>

      {/* Payment & receipts */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Payment and receipts
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <EField label="Payment method">
              <ESelect value={method} onChange={(e) => updatePayment({ method: e.target.value as PaymentMethod })}>
                <option value="COMPANY_CARD">Company card</option>
                <option value="CLIENT_CARD">Client card</option>
                <option value="CLEANER_PERSONAL_CARD">Cleaner personal card</option>
                <option value="ADMIN_PERSONAL_CARD">Admin personal card</option>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="OTHER">Other</option>
              </ESelect>
            </EField>
            <EField label="Paid by scope">
              <EInput value={run.payment?.paidByScope?.replace(/_/g, " ") ?? "-"} disabled />
            </EField>
            <EField label="Paid by name">
              <EInput
                placeholder="Paid by name"
                value={run.payment?.paidByName ?? ""}
                onChange={(e) => updatePayment({ paidByName: e.target.value })}
              />
            </EField>
            <EField label="Payment note">
              <EInput
                placeholder="Payment note"
                value={run.payment?.note ?? ""}
                onChange={(e) => updatePayment({ note: e.target.value })}
              />
            </EField>
          </div>

          <EAlert tone="success">{paymentGuidance(method, run.ownerScope)}</EAlert>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-3 py-2 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]">
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  void uploadReceipts(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload receipts"}
            </label>
            <EButton variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={downloading}>
              <Download className="h-4 w-4" /> {downloading ? "Preparing…" : "PDF"}
            </EButton>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Client charge: {run.clientChargeStatus || "-"}
            </span>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Cleaner reimbursement: {run.cleanerReimbursementStatus || "-"}
            </span>
          </div>

          {(run.payment?.receipts?.length ?? 0) > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {(run.payment?.receipts ?? []).map((receipt) => (
                <div
                  key={receipt.key}
                  className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.875rem]"
                >
                  <a
                    href={receipt.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    {receipt.name}
                  </a>
                  <EButton
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updatePayment({
                        receipts: (run.payment?.receipts ?? []).filter((i) => i.key !== receipt.key),
                      })
                    }
                  >
                    Remove
                  </EButton>
                </div>
              ))}
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Shopping time (cleaner only) */}
      {run.ownerScope === "CLEANER" ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Shopping time</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <EField label="Minutes spent shopping">
                <EInput
                  type="number"
                  min="0"
                  max="1440"
                  value={run.shoppingTime?.requestedMinutes ?? 0}
                  onChange={(e) => setTime({ requestedMinutes: Math.max(0, Number(e.target.value || 0)) })}
                />
              </EField>
              <EField label="Time note for admin">
                <ETextarea
                  placeholder="What took extra time while shopping?"
                  value={run.shoppingTime?.note ?? ""}
                  onChange={(e) => setTime({ note: e.target.value })}
                />
              </EField>
            </div>
            <div className="flex flex-wrap gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
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
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Shopping time does not reach the cleaner invoice until admin approves it.
            </p>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Custom purchases */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Custom purchases</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_110px_110px]">
            <ESelect
              value={customDraft.propertyId}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, propertyId: e.target.value }))}
            >
              <option value="">Select property</option>
              {propertyOptions.map((property) => (
                <option key={property.propertyId} value={property.propertyId}>
                  {property.propertyName} ({property.suburb})
                </option>
              ))}
            </ESelect>
            <EInput
              placeholder="Purchase name"
              value={customDraft.itemName}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, itemName: e.target.value }))}
            />
            <EInput
              placeholder="Qty"
              type="number"
              min="0"
              step="0.01"
              value={customDraft.qty}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, qty: e.target.value }))}
            />
            <EInput
              placeholder="Unit cost"
              type="number"
              min="0"
              step="0.01"
              value={customDraft.unitCost}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, unitCost: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_140px_1fr_auto] lg:items-end">
            <EInput
              placeholder="Category"
              value={customDraft.category}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, category: e.target.value }))}
            />
            <EInput
              placeholder="Unit"
              value={customDraft.unit}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, unit: e.target.value }))}
            />
            <EInput
              placeholder="Optional note"
              value={customDraft.note}
              onChange={(e) => setCustomDraft((prev) => ({ ...prev, note: e.target.value }))}
            />
            <EButton type="button" onClick={addCustomPurchase}>
              <Plus className="h-4 w-4" /> Add
            </EButton>
          </div>
          {customRows.length > 0 ? (
            <div className="space-y-3">
              {customRows.map((row) => (
                <div
                  key={`${row.propertyId}-${row.itemId}`}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.875rem] font-[550]">{row.itemName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.propertyName} · {row.category} · {row.unit}
                      </p>
                    </div>
                    <EButton
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCustomPurchase(row.itemId, row.propertyId)}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </EButton>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[120px_120px_1fr]">
                    <EInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.actualPurchasedQty ?? 0}
                      onChange={(e) =>
                        updateRow(row.itemId, row.propertyId, {
                          actualPurchasedQty: Math.max(0, Number(e.target.value || 0)),
                          plannedQty: Math.max(0, Number(e.target.value || 0)),
                          purchased: true,
                          include: true,
                        })
                      }
                    />
                    <EInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.actualUnitCost ?? 0}
                      onChange={(e) =>
                        updateRow(row.itemId, row.propertyId, {
                          actualUnitCost: Math.max(0, Number(e.target.value || 0)),
                          purchased: true,
                          include: true,
                        })
                      }
                    />
                    <EInput
                      value={row.note ?? ""}
                      onChange={(e) => updateRow(row.itemId, row.propertyId, { note: e.target.value })}
                      placeholder="Receipt or purchase note"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Add manual purchases here when the item was not already on the planned shopping list.
            </p>
          )}
        </ECardBody>
      </ECard>

      {/* Planned rows by property */}
      <div className="space-y-4">
        {grouped.map((group) => (
          <ECard key={group.propertyId}>
            <ECardHeader>
              <ECardTitle>
                {group.propertyName}{" "}
                <span className="text-[0.8125rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                  ({group.suburb})
                </span>
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-3">
              {group.rows.map((row) => (
                <div
                  key={`${row.propertyId}-${row.itemId}`}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.875rem] font-[550]">{row.itemName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.category}
                        {row.supplier ? ` · ${row.supplier}` : ""} · {row.unit}
                      </p>
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        On hand {row.onHand} · Need {row.needed} · Planned {row.plannedQty}
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <EInput
                        type="number"
                        min="0"
                        value={row.actualPurchasedQty ?? 0}
                        onChange={(e) =>
                          updateRow(row.itemId, row.propertyId, {
                            actualPurchasedQty: Math.max(0, Number(e.target.value || 0)),
                            purchased: true,
                          })
                        }
                        aria-label="Purchased quantity"
                      />
                      <EInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.actualUnitCost ?? ""}
                        onChange={(e) =>
                          updateRow(row.itemId, row.propertyId, {
                            actualUnitCost: e.target.value === "" ? null : Math.max(0, Number(e.target.value || 0)),
                            purchased: true,
                          })
                        }
                        aria-label="Actual unit cost"
                      />
                      <label className="flex items-center justify-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem]">
                        <ECheckbox
                          checked={row.purchased}
                          onChange={(e) => updateRow(row.itemId, row.propertyId, { purchased: e.target.checked })}
                        />
                        Bought
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_180px]">
                    <ETextarea
                      rows={2}
                      placeholder="Item note / not found note"
                      value={row.note ?? ""}
                      onChange={(e) => updateRow(row.itemId, row.propertyId, { note: e.target.value })}
                    />
                    <EInput value={row.priority || "Medium"} disabled />
                    <EInput value={`Actual ${money(row.actualLineCost || 0)}`} disabled />
                  </div>
                </div>
              ))}
            </ECardBody>
          </ECard>
        ))}
      </div>
    </div>
  );
}
