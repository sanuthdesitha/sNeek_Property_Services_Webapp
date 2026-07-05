"use client";

/**
 * Estate shopping run workspace (client) — same endpoints as the legacy
 * ShoppingRunWorkspace:
 *   GET   /api/client/inventory/shopping-runs/:id            → RunDetail
 *   PATCH /api/client/inventory/shopping-runs/:id  { name, status, planningScope, startedAt, completedAt, payment, rows }
 *   GET   /api/client/inventory/shopping-runs/:id/pdf        → blob
 *   POST  /api/uploads/direct  (multipart)                   → { key, url }
 * Client owner scope only (no admin on-hand deposit, no cleaner shopping-time).
 * Styled purely with `--e-*` tokens. No v1 UI imports.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Play, Plus, Receipt, Save, ShoppingBag, Trash2, Upload } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ESelect, ETextarea, EField } from "@/components/v2/admin/estate-kit";
import { EInlineNotice } from "@/components/v2/client/fields";
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
    paidByName?: string | null;
    note?: string;
    receipts: Attachment[];
  };
  rows: RunRow[];
  totals?: { estimatedTotalCost?: number; actualTotalCost?: number };
  clientChargeStatus?: string;
};

type CustomDraft = { propertyId: string; itemName: string; category: string; unit: string; qty: string; unitCost: string; note: string };

const money = (v: number | null | undefined) => `$${Number(v ?? 0).toFixed(2)}`;

function statusMeta(status: RunStatus): { label: string; tone: "gold" | "success" | "neutral" } {
  if (status === "IN_PROGRESS") return { label: "Shopping in progress", tone: "gold" };
  if (status === "COMPLETED") return { label: "Submitted for review", tone: "success" };
  return { label: "Draft planning", tone: "neutral" };
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
    default:
      return ownerScope === "CLIENT" ? "CLIENT" : "CLEANER";
  }
}
function paymentGuidance(method: PaymentMethod, ownerScope: "CLIENT" | "CLEANER") {
  const scope = derivePaidByScope(method, ownerScope);
  if (scope === "CLIENT") return "Client-paid purchase. No reimbursement is needed.";
  if (scope === "CLEANER") return "Cleaner-paid purchase. Admin approval is required before reimbursement.";
  if (scope === "ADMIN") return "Admin-paid purchase. Cleaner reimbursement is not needed.";
  return "Company-paid purchase. Cleaner reimbursement is not needed.";
}
function timeLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-AU");
}

export function ShoppingRunWorkspaceEstate({
  apiBase,
  runId,
  backHref,
  backLabel,
}: {
  apiBase: string;
  runId: string;
  backHref: string;
  backLabel: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${runId}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load shopping run.");
      setRun(body as RunDetail);
    } catch (e: any) {
      setError(e?.message ?? "Could not load shopping run.");
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
    for (const row of run.rows.filter((r) => !r.isCustom)) {
      if (!map.has(row.propertyId))
        map.set(row.propertyId, { propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb, rows: [] });
      map.get(row.propertyId)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [run]);

  const customRows = useMemo(() => (run?.rows ?? []).filter((r) => r.isCustom), [run]);

  const propertyOptions = useMemo(() => {
    if (!run) return [] as Array<{ propertyId: string; propertyName: string; suburb: string }>;
    const seen = new Map<string, { propertyId: string; propertyName: string; suburb: string }>();
    for (const row of run.rows)
      if (!seen.has(row.propertyId))
        seen.set(row.propertyId, { propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb });
    return Array.from(seen.values());
  }, [run]);

  useEffect(() => {
    if (!customDraft.propertyId && propertyOptions.length > 0)
      setCustomDraft((prev) => ({ ...prev, propertyId: propertyOptions[0]!.propertyId }));
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
      const rows = prev.rows.map((row) => {
        if (row.itemId !== itemId || row.propertyId !== propertyId) return row;
        const next = { ...row, ...patch };
        const qty = Number(next.actualPurchasedQty || 0);
        const unitCost = next.actualUnitCost == null ? null : Number(next.actualUnitCost || 0);
        next.actualLineCost = unitCost == null ? null : qty * unitCost;
        const estUnit = next.estimatedUnitCost == null ? unitCost : Number(next.estimatedUnitCost || 0);
        next.estimatedUnitCost = estUnit;
        next.estimatedLineCost = estUnit == null ? null : Math.max(0, Number(next.plannedQty || 0)) * estUnit;
        return next;
      });
      return { ...prev, rows };
    });
  }

  function updatePayment(patch: Partial<NonNullable<RunDetail["payment"]>>) {
    setRun((prev) => {
      if (!prev) return prev;
      const nextMethod = (patch.method ??
        prev.payment?.method ??
        (prev.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD")) as PaymentMethod;
      const base = prev.payment ?? {
        method: prev.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD",
        paidByScope: prev.ownerScope === "CLIENT" ? "CLIENT" : "COMPANY",
        receipts: [],
      };
      return { ...prev, payment: { ...base, ...patch, method: nextMethod, paidByScope: derivePaidByScope(nextMethod, prev.ownerScope) } };
    });
  }

  function addCustomPurchase() {
    if (!run) return;
    if (!customDraft.propertyId || !customDraft.itemName.trim()) {
      setError("Choose a property and enter the purchase name.");
      return;
    }
    const qty = Math.max(0, Number(customDraft.qty || 0));
    const unitCost = Math.max(0, Number(customDraft.unitCost || 0));
    if (qty <= 0 || unitCost <= 0) {
      setError("Custom purchases need both quantity and unit cost.");
      return;
    }
    const property = propertyOptions.find((p) => p.propertyId === customDraft.propertyId);
    if (!property) return;
    setError(null);
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
    setError(null);
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
    } catch (e: any) {
      setError(e?.message ?? "Could not save shopping run.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadReceipts(fileList: FileList | null) {
    if (!run || !fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
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
    } catch (e: any) {
      setError(e?.message ?? "Could not upload receipts.");
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
    } catch (e: any) {
      setError(e?.message ?? "Could not download the run PDF.");
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
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </EButton>
        {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
        <ECard>
          <ECardBody className="py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            This shopping run could not be loaded.
          </ECardBody>
        </ECard>
      </div>
    );
  }

  const meta = statusMeta(run.status);
  const readOnly = run.status === "COMPLETED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <EEyebrow>Shopping run</EEyebrow>
          <h1 className="e-display-md mt-1">{run.name}</h1>
          <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Owner {run.ownerName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EBadge tone={meta.tone} soft>
            {meta.label}
          </EBadge>
          <EButton asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </EButton>
          <EButton variant="ghost" size="sm" onClick={() => void loadRun()}>
            Refresh
          </EButton>
        </div>
      </div>

      {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

      {/* Summary */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Lines", String(summary.lines)],
          ["Planned units", String(summary.planned)],
          ["Purchased units", String(summary.purchased)],
          ["Estimated total", money(summary.estimated)],
          ["Actual total", money(summary.actual)],
        ].map(([label, value]) => (
          <ECard key={label}>
            <ECardBody className="p-4">
              <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
              <p className="e-numeral e-tnum mt-1 text-[1.5rem] leading-none">{value}</p>
            </ECardBody>
          </ECard>
        ))}
      </section>

      {/* Run controls */}
      <ECard>
        <ECardBody className="space-y-4 p-6">
          <EEyebrow>Run controls</EEyebrow>
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
            <EField label="Run name">
              <EInput
                value={run.name}
                disabled={readOnly}
                onChange={(e) => setRun((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              />
            </EField>
            <EField label="Timeline">
              <EInput value={`Started ${timeLabel(run.startedAt)} · Submitted ${timeLabel(run.completedAt)}`} disabled />
            </EField>
          </div>
          <div className="flex flex-wrap gap-2">
            <EButton variant="outline" onClick={() => void save("IN_PROGRESS")} disabled={saving || readOnly}>
              <Play className="h-4 w-4" />
              Mark active
            </EButton>
            <EButton variant="outline" onClick={() => void save()} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save draft"}
            </EButton>
            <EButton onClick={() => void save("COMPLETED")} disabled={saving || readOnly}>
              <ShoppingBag className="h-4 w-4" />
              {readOnly ? "Submitted" : "Submit run"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      {/* Payment & receipts */}
      <ECard>
        <ECardBody className="space-y-4 p-6">
          <EEyebrow className="flex items-center gap-2">
            <Receipt className="h-3.5 w-3.5" /> Payment & receipts
          </EEyebrow>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <EField label="Payment method">
              <ESelect
                value={run.payment?.method ?? (run.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD")}
                onChange={(e) => updatePayment({ method: e.target.value as PaymentMethod })}
                disabled={readOnly}
              >
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
              <EInput value={run.payment?.paidByScope?.replace(/_/g, " ") ?? "—"} disabled />
            </EField>
            <EField label="Paid by name">
              <EInput
                placeholder="Paid by name"
                value={run.payment?.paidByName ?? ""}
                onChange={(e) => updatePayment({ paidByName: e.target.value })}
                disabled={readOnly}
              />
            </EField>
            <EField label="Payment note">
              <EInput
                placeholder="Payment note"
                value={run.payment?.note ?? ""}
                onChange={(e) => updatePayment({ note: e.target.value })}
                disabled={readOnly}
              />
            </EField>
          </div>
          <div className="rounded-[var(--e-radius-lg)] border-l-[3px] p-3 text-[0.8125rem]"
            style={{ backgroundColor: "hsl(var(--e-success-soft))", borderColor: "hsl(var(--e-success))", color: "hsl(var(--e-foreground))" }}>
            {paymentGuidance(run.payment?.method ?? (run.ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD"), run.ownerScope)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]">
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf"
                disabled={readOnly || uploading}
                onChange={(e) => {
                  void uploadReceipts(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading…" : "Upload receipts"}
            </label>
            <EButton variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={downloading}>
              <Download className="h-4 w-4" />
              {downloading ? "Preparing…" : "PDF"}
            </EButton>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Client charge: {run.clientChargeStatus || "—"}
            </span>
          </div>
          {(run.payment?.receipts?.length ?? 0) > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {(run.payment?.receipts ?? []).map((receipt) => (
                <div
                  key={receipt.key}
                  className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]"
                >
                  <a href={receipt.url} target="_blank" rel="noreferrer" className="truncate font-[550] text-[hsl(var(--e-gold-ink))] hover:underline">
                    {receipt.name}
                  </a>
                  {!readOnly ? (
                    <EButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updatePayment({ receipts: (run.payment?.receipts ?? []).filter((i) => i.key !== receipt.key) })
                      }
                    >
                      Remove
                    </EButton>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Custom purchases */}
      <ECard>
        <ECardBody className="space-y-4 p-6">
          <EEyebrow>Custom purchases</EEyebrow>
          {!readOnly ? (
            <>
              <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_110px_110px]">
                <EField label="Property">
                  <ESelect
                    value={customDraft.propertyId}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, propertyId: e.target.value }))}
                  >
                    <option value="">Select property</option>
                    {propertyOptions.map((p) => (
                      <option key={p.propertyId} value={p.propertyId}>
                        {p.propertyName} ({p.suburb})
                      </option>
                    ))}
                  </ESelect>
                </EField>
                <EField label="Purchase name">
                  <EInput
                    placeholder="Purchase name"
                    value={customDraft.itemName}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, itemName: e.target.value }))}
                  />
                </EField>
                <EField label="Qty">
                  <EInput
                    type="number"
                    min={0}
                    step="0.01"
                    value={customDraft.qty}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, qty: e.target.value }))}
                  />
                </EField>
                <EField label="Unit cost">
                  <EInput
                    type="number"
                    min={0}
                    step="0.01"
                    value={customDraft.unitCost}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, unitCost: e.target.value }))}
                  />
                </EField>
              </div>
              <div className="grid items-end gap-3 lg:grid-cols-[1fr_140px_1fr_auto]">
                <EField label="Category">
                  <EInput
                    value={customDraft.category}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, category: e.target.value }))}
                  />
                </EField>
                <EField label="Unit">
                  <EInput
                    value={customDraft.unit}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, unit: e.target.value }))}
                  />
                </EField>
                <EField label="Note">
                  <EInput
                    placeholder="Optional note"
                    value={customDraft.note}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, note: e.target.value }))}
                  />
                </EField>
                <EButton type="button" onClick={addCustomPurchase}>
                  <Plus className="h-4 w-4" />
                  Add
                </EButton>
              </div>
            </>
          ) : null}
          {customRows.length > 0 ? (
            <div className="space-y-3">
              {customRows.map((row) => (
                <div key={`${row.propertyId}-${row.itemId}`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-[550]">{row.itemName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.propertyName} · {row.category} · {row.unit}
                      </p>
                    </div>
                    {!readOnly ? (
                      <EButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCustomPurchase(row.itemId, row.propertyId)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </EButton>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[120px_120px_1fr]">
                    <EInput
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={readOnly}
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
                      min={0}
                      step="0.01"
                      disabled={readOnly}
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
                      disabled={readOnly}
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

      {/* Planned line items */}
      <div className="space-y-4">
        {grouped.map((group) => (
          <ECard key={group.propertyId}>
            <ECardBody className="space-y-3 p-6">
              <p className="font-[550]">
                {group.propertyName}{" "}
                <span className="text-[0.875rem] font-normal text-[hsl(var(--e-muted-foreground))]">({group.suburb})</span>
              </p>
              {group.rows.map((row) => (
                <div key={`${row.propertyId}-${row.itemId}`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-[550]">{row.itemName}</p>
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
                        min={0}
                        disabled={readOnly}
                        value={row.actualPurchasedQty ?? 0}
                        onChange={(e) =>
                          updateRow(row.itemId, row.propertyId, {
                            actualPurchasedQty: Math.max(0, Number(e.target.value || 0)),
                            purchased: true,
                          })
                        }
                      />
                      <EInput
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={readOnly}
                        value={row.actualUnitCost ?? ""}
                        onChange={(e) =>
                          updateRow(row.itemId, row.propertyId, {
                            actualUnitCost: e.target.value === "" ? null : Math.max(0, Number(e.target.value || 0)),
                            purchased: true,
                          })
                        }
                      />
                      <label className="flex items-center justify-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem]">
                        <input
                          type="checkbox"
                          checked={row.purchased}
                          disabled={readOnly}
                          onChange={(e) => updateRow(row.itemId, row.propertyId, { purchased: e.target.checked })}
                        />
                        Bought
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_160px]">
                    <ETextarea
                      rows={2}
                      placeholder="Item note / not found note"
                      disabled={readOnly}
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
